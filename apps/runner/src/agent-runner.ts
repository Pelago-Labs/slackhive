/**
 * @fileoverview Agent runner — manages the lifecycle of all Slack bot instances.
 *
 * The AgentRunner is the top-level orchestrator for the runner service.
 * On startup it loads all active agents from the database, starts a Slack
 * Bolt App for each one, and listens on Redis for reload signals from the
 * web UI.
 *
 * Each agent gets:
 * - Its own Bolt App instance (separate Slack socket connection)
 * - Its own ClaudeHandler (session manager, MCP wiring, tool permissions)
 * - Its own MemoryWatcher (syncs learned memories to the database)
 * - A compiled CLAUDE.md in /tmp/agents/{slug}/ (skills + memories)
 *
 * Hot reload flow:
 * 1. User edits skills/MCPs/permissions in the web UI
 * 2. Web API publishes `{ type: 'reload', agentId }` to Redis channel
 * 3. AgentRunner receives the event, stops the agent, recompiles, restarts
 *
 * @module runner/agent-runner
 */

import { App, LogLevel } from '@slack/bolt';
import type { Agent } from '@slackhive/shared';
import { type AgentEvent, getEventBus, type EventBus } from '@slackhive/shared';
import { JobScheduler } from './job-scheduler';
import {
  getAllAgents,
  getAgentById,
  getAgentMcpServers,
  getAgentPermissions,
  getAgentRestrictions,
  getAgentMemories,
  getAgentSkills,
  getAllEnvVarValues,
  updateAgentStatus,
  setOptimizeResult,
} from './db';
import { compileClaudeMd, materializeMemoryFiles } from './compile-claude-md';
import { ClaudeHandler } from './claude-handler';
import { MemoryWatcher } from './memory-watcher';
import { registerSlackHandlers } from './slack-handler';
import { logger } from './logger';

/**
 * Represents a fully initialized running agent.
 * All resources owned by a running agent are held here for cleanup.
 */
interface RunningAgent {
  agent: Agent;
  app: App;
  claudeHandler: ClaudeHandler;
  memoryWatcher: MemoryWatcher;
}

/**
 * Manages the lifecycle of all Claude Code Slack bot instances.
 *
 * @example
 * const runner = new AgentRunner();
 * await runner.start();
 * // Ctrl+C triggers graceful shutdown
 */
export class AgentRunner {
  /** Map of agent ID → running agent resources. */
  private runningAgents: Map<string, RunningAgent> = new Map();

  /** Scheduled job executor. */
  private jobScheduler: JobScheduler;

  /** Event bus for hot-reload events (Redis or in-memory). */
  private eventBus: EventBus | null = null;

  constructor() {
    this.jobScheduler = new JobScheduler((agentId: string) => this.getRunningAgent(agentId));
  }

  /**
   * Returns any running agent by ID, or undefined if not running.
   */
  getRunningAgent(agentId: string): { app: App; claudeHandler: import('./claude-handler').ClaudeHandler } | undefined {
    const ra = this.runningAgents.get(agentId);
    return ra ? { app: ra.app, claudeHandler: ra.claudeHandler } : undefined;
  }

  /**
   * Starts the runner:
   * 1. Connects to Redis for hot-reload events
   * 2. Loads and starts all active agents from the database
   * 3. Registers graceful shutdown handlers
   *
   * @returns {Promise<void>}
   * @throws {Error} If Redis connection fails.
   */
  async start(): Promise<void> {
    logger.info('AgentRunner starting...');

    await this.connectEventBus();
    await this.loadAllAgents();
    await this.jobScheduler.start();
    this.registerShutdownHandlers();

    logger.info('AgentRunner started', { agents: this.runningAgents.size });
  }

  /**
   * Gracefully stops all running agents and disconnects from Redis.
   *
   * @returns {Promise<void>}
   */
  async stop(): Promise<void> {
    logger.info('AgentRunner stopping...');

    // Stop job scheduler
    await this.jobScheduler.stop();

    // Stop all agents concurrently
    const stopPromises = Array.from(this.runningAgents.keys()).map((id) =>
      this.stopAgent(id).catch((err) =>
        logger.warn('Error stopping agent during shutdown', { agentId: id, error: err.message })
      )
    );
    await Promise.all(stopPromises);

    if (this.eventBus) {
      await this.eventBus.close();
      this.eventBus = null;
    }

    logger.info('AgentRunner stopped');
  }

  // ===========================================================================
  // Agent lifecycle
  // ===========================================================================

  /**
   * Loads all agents from the database and starts each one.
   *
   * @returns {Promise<void>}
   */
  private async loadAllAgents(): Promise<void> {
    const agents = await getAllAgents();
    logger.info('Loading agents from database', { count: agents.length });

    // Start agents sequentially to avoid overwhelming Slack's rate limits.
    // Skip agents that are stopped or have placeholder/missing tokens.
    for (const agent of agents) {
      if (agent.enabled === false) {
        logger.info('Skipping disabled agent', { agent: agent.slug });
        continue;
      }
      if (
        !agent.slackBotToken.startsWith('xoxb-') ||
        !agent.slackAppToken.startsWith('xapp-') ||
        agent.slackBotToken.includes('placeholder') ||
        agent.slackAppToken.includes('placeholder')
      ) {
        logger.warn('Skipping agent with invalid/placeholder tokens', { agent: agent.slug });
        await updateAgentStatus(agent.id, 'stopped');
        continue;
      }
      try {
        await this.startAgent(agent);
      } catch (err) {
        logger.error('Failed to start agent', { agent: agent.slug, error: (err as Error).message });
        await updateAgentStatus(agent.id, 'error');
      }
    }
  }

  /**
   * Starts a single agent:
   * 1. Loads its MCP servers and permissions from the database
   * 2. Compiles CLAUDE.md from skills + memories
   * 3. Materializes memory files to disk
   * 4. Creates Bolt App + ClaudeHandler + MemoryWatcher
   * 5. Registers Slack event handlers
   * 6. Starts the Bolt App (opens Socket Mode connection)
   *
   * @param {Agent} agent - The agent to start.
   * @returns {Promise<void>}
   * @throws {Error} If Slack App fails to start.
   */
  private async startAgent(agent: Agent): Promise<void> {
    if (this.runningAgents.has(agent.id)) {
      logger.warn('Agent already running, skipping start', { agent: agent.slug });
      return;
    }

    logger.info('Starting agent', { agent: agent.slug });

    // Load configuration from DB
    const [mcpServers, permissions, restrictions, memories, envVarValues] = await Promise.all([
      getAgentMcpServers(agent.id),
      getAgentPermissions(agent.id),
      getAgentRestrictions(agent.id),
      getAgentMemories(agent.id),
      getAllEnvVarValues(),
    ]);

    // Compile CLAUDE.md (identity + skills → temp workspace)
    const workDir = await compileClaudeMd(agent);

    // Materialize memory files so the /recall skill can read them
    materializeMemoryFiles(agent, memories);

    // Create Claude Code SDK handler
    const claudeHandler = new ClaudeHandler(agent, mcpServers, permissions, workDir, envVarValues);
    claudeHandler.initialize();

    // Create memory watcher (persists SDK memory writes back to DB)
    const memoryWatcher = new MemoryWatcher(agent);
    memoryWatcher.start();

    // Create Slack Bolt App in Socket Mode
    const app = new App({
      token: agent.slackBotToken,
      appToken: agent.slackAppToken,
      signingSecret: agent.slackSigningSecret,
      socketMode: true,
      logLevel: process.env.LOG_LEVEL === 'debug' ? LogLevel.DEBUG : LogLevel.WARN,
    });

    // Register all Slack event listeners
    registerSlackHandlers(app, agent, claudeHandler, restrictions);

    // Start the Bolt App
    await app.start();

    // Fetch and store the bot's Slack user ID for @mention construction
    try {
      const authResult = await app.client.auth.test({ token: agent.slackBotToken });
      if (authResult.user_id && authResult.user_id !== agent.slackBotUserId) {
        await updateAgentStatus(agent.id, 'running'); // Will also trigger updateAgentSlackUserId below
        const { updateAgentSlackUserId } = await import('./db');
        await updateAgentSlackUserId(agent.id, authResult.user_id as string);
        agent.slackBotUserId = authResult.user_id as string;
      }
    } catch (err) {
      logger.warn('Failed to fetch bot user ID', { agent: agent.slug, error: err });
    }

    this.runningAgents.set(agent.id, { agent, app, claudeHandler, memoryWatcher });
    await updateAgentStatus(agent.id, 'running');

    logger.info('Agent started', {
      agent: agent.slug,
      mcpServers: mcpServers.map((m) => m.name),
    });
  }

  /**
   * Stops a running agent and cleans up all its resources.
   *
   * @param {string} agentId - UUID of the agent to stop.
   * @returns {Promise<void>}
   */
  private async stopAgent(agentId: string): Promise<void> {
    const running = this.runningAgents.get(agentId);
    if (!running) return;

    const { agent, app, claudeHandler, memoryWatcher } = running;
    logger.info('Stopping agent', { agent: agent.slug });

    memoryWatcher.stop();
    claudeHandler.destroy();

    try {
      await app.stop();
    } catch (err) {
      logger.warn('Error stopping Bolt App', { agent: agent.slug, error: err });
    }

    this.runningAgents.delete(agentId);
    await updateAgentStatus(agentId, 'stopped');

    logger.info('Agent stopped', { agent: agent.slug });
  }

  /**
   * Reloads an agent: stops it, re-fetches its config, recompiles, and restarts.
   * Called when the web UI publishes a reload event.
   *
   * @param {string} agentId - UUID of the agent to reload.
   * @returns {Promise<void>}
   */
  private async reloadAgent(agentId: string): Promise<void> {
    logger.info('Reloading agent', { agentId });

    await this.stopAgent(agentId);

    const agent = await getAgentById(agentId);
    if (!agent) {
      logger.warn('Agent not found after reload event', { agentId });
      return;
    }

    await this.startAgent(agent);
  }

  // ===========================================================================
  // Event bus (Redis or in-memory)
  // ===========================================================================

  /**
   * Connects to the event bus and subscribes to agent lifecycle events.
   * Uses Redis if REDIS_URL is set, otherwise falls back to in-memory EventEmitter.
   *
   * @returns {Promise<void>}
   */
  private async connectEventBus(): Promise<void> {
    this.eventBus = getEventBus();

    await this.eventBus.subscribe((event: AgentEvent) => {
      logger.info('Received agent event', { event });

      switch (event.type) {
        case 'reload':
          this.reloadAgent(event.agentId).catch((err) =>
            logger.error('Failed to reload agent', { agentId: event.agentId, error: err.message })
          );
          break;
        case 'start':
          getAgentById(event.agentId)
            .then((agent) => agent && this.startAgent(agent))
            .catch((err) =>
              logger.error('Failed to start agent', { agentId: event.agentId, error: err.message })
            );
          break;
        case 'stop':
          this.stopAgent(event.agentId).catch((err) =>
            logger.error('Failed to stop agent', { agentId: event.agentId, error: err.message })
          );
          break;
        case 'reload-jobs':
          this.jobScheduler.reload().catch((err) =>
            logger.error('Failed to reload jobs', { error: (err as Error).message })
          );
          break;
        case 'optimize':
          this.optimizeAgent(event.agentId, event.requestId).catch((err) =>
            logger.error('Failed to optimize agent', { agentId: event.agentId, error: err.message })
          );
          break;
      }
    });

    logger.info('Event bus connected', { type: this.eventBus.type });
  }

  // ===========================================================================
  // Optimize agent instructions via Claude
  // ===========================================================================

  /**
   * Calls Claude to analyze and suggest improvements for an agent's instructions.
   * Result is stored in the DB for the web UI to poll.
   */
  private async optimizeAgent(agentId: string, requestId: string): Promise<void> {
    logger.info('Optimizing agent instructions', { agentId, requestId });

    try {
      const agent = await getAgentById(agentId);
      if (!agent) {
        await setOptimizeResult(requestId, JSON.stringify({ status: 'error', error: 'Agent not found' }));
        return;
      }

      const [skills, memories] = await Promise.all([
        getAgentSkills(agentId),
        getAgentMemories(agentId),
      ]);

      // Build the optimization prompt
      const skillsList = skills.map(s =>
        `### ${s.category}/${s.filename}\n\`\`\`\n${s.content}\n\`\`\``
      ).join('\n\n');

      const optimizationPrompt = `You are an expert at writing Claude Code agent instructions for Slack-based AI agents.

Review this agent's configuration and suggest concrete improvements. Return ONLY valid JSON (no markdown fences).

## Agent
Name: ${agent.name}
Description: ${agent.description || '(none)'}
Persona: ${agent.persona || '(none)'}

## Current System Prompt
${agent.claudeMd || '(empty — agent is using auto-generated identity from persona)'}

## Current Skills (${skills.length} files)
${skillsList || '(no skills yet)'}

## Memories: ${memories.length} entries

## Your Task
Analyze the system prompt and skills. Return JSON with this exact shape:
{
  "score": <number 0-100>,
  "summary": "<2-3 sentence assessment>",
  "systemPrompt": {
    "issues": ["<specific problem>", ...],
    "suggestion": "<improved full system prompt text>",
    "explanation": "<why this is better>"
  },
  "skills": [
    {
      "filename": "<existing-or-new.md>",
      "category": "<category>",
      "action": "improve" | "create" | "delete",
      "currentContent": "<current content if improving, empty if creating>",
      "suggestion": "<improved or new content>",
      "explanation": "<why>"
    }
  ],
  "tips": ["<actionable tip>", ...]
}

Guidelines:
- Be specific — show exact improved text, not vague advice
- If the system prompt is empty, suggest a good starting prompt based on the persona/description
- If skills are missing, suggest 1-2 useful ones based on the agent's purpose
- Score 0-30: needs major work, 30-60: decent but improvable, 60-80: good, 80+: excellent
- Keep suggestions practical for a Slack bot context (concise responses, formatting for Slack)`;

      // Mark as running
      await setOptimizeResult(requestId, JSON.stringify({ status: 'running' }));

      // Call Claude SDK
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      let fullResponse = '';

      for await (const msg of query({
        prompt: optimizationPrompt,
        options: {
          maxTurns: 1,
          tools: [],
          allowedTools: [],
        },
      })) {
        // Collect text from assistant messages
        if (msg.type === 'assistant') {
          const content: any[] = (msg as any).message?.content ?? [];
          for (const block of content) {
            if (block.type === 'text') fullResponse += block.text;
          }
        }
        // Also check result messages
        if (msg.type === 'result') {
          const resultText = (msg as any).result as string | undefined;
          if (resultText) fullResponse = resultText;
        }
      }

      // Parse the JSON response
      // Try to extract JSON from the response (Claude might wrap it in markdown)
      let jsonStr = fullResponse;
      const fenceMatch = fullResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) jsonStr = fenceMatch[1];

      // Try to find JSON object in the response
      const braceStart = jsonStr.indexOf('{');
      const braceEnd = jsonStr.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) {
        jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
      }

      const parsed = JSON.parse(jsonStr);
      await setOptimizeResult(requestId, JSON.stringify({ status: 'done', ...parsed }));
      logger.info('Optimization complete', { agentId, requestId, score: parsed.score });

    } catch (err) {
      const message = (err as Error).message ?? String(err);
      logger.error('Optimization failed', { agentId, requestId, error: message });

      let userError = 'Optimization failed. ';
      if (message.includes('401') || message.includes('auth') || message.includes('credentials')) {
        userError += 'Claude not authenticated. Check your API key or run `claude login`.';
      } else if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
        userError += 'Request timed out. Try again.';
      } else if (message.includes('rate') || message.includes('429')) {
        userError += 'Rate limited. Wait a moment and try again.';
      } else if (message.includes('JSON')) {
        userError += 'Claude returned an unexpected format. Try again.';
      } else {
        userError += message;
      }

      await setOptimizeResult(requestId, JSON.stringify({ status: 'error', error: userError }));
    }
  }

  // ===========================================================================
  // Graceful shutdown
  // ===========================================================================

  /**
   * Registers SIGTERM and SIGINT handlers for graceful shutdown.
   * Ensures all agents are cleanly stopped before the process exits.
   *
   * @returns {void}
   */
  private registerShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}
