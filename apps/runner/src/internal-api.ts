/**
 * @fileoverview Internal HTTP API for the runner service.
 *
 * Provides endpoints that the web UI calls for operations requiring
 * the Claude Code SDK (which only the runner has access to).
 *
 * Endpoints:
 *   POST /generate-skill  — Generate or improve a skill using Claude Code
 *   POST /audit-skills    — Audit all skills together for quality issues
 *
 * Authentication uses the same credentials as all agents — either
 * ANTHROPIC_API_KEY or OAuth subscription via ~/.claude/.credentials.json.
 * No separate auth flow is needed.
 *
 * @module runner/internal-api
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { logger } from './logger';

const PORT = parseInt(process.env.RUNNER_API_PORT ?? '3002', 10);

interface GenerateSkillRequest {
  mode: 'generate' | 'improve';
  target?: 'skill' | 'claude-md';
  description?: string;
  content?: string;
  filename?: string;
  instructions?: string;
  agentName: string;
  agentPersona: string | null;
  mcpNames: string[];
  existingSkillNames: string[];
}

interface AuditSkillsRequest {
  agentName: string;
  agentPersona: string | null;
  mcpNames: string[];
  claudeMd: string;
  skills: { category: string; filename: string; content: string }[];
}

interface AuditFinding {
  type: 'duplicate' | 'contradiction' | 'gap' | 'overlap' | 'consolidate' | 'quality';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedFiles: string[];
  suggestion?: string;
  proposedContent?: string;
  proposedFilename?: string;
  proposedCategory?: string;
}

/**
 * Build a system prompt for skill generation.
 */
function buildSkillSystemPrompt(
  agentName: string,
  agentPersona: string | null,
  mcpNames: string[],
  existingSkillNames: string[]
): string {
  return `You are an expert at writing skills for SlackHive agents. Skills are markdown files that become Claude Code slash commands — they guide the agent's behavior for specific tasks.

## Context about the target agent
- Agent name: ${agentName}
- Agent persona: ${agentPersona ?? 'Not specified'}
- Connected MCP tools: ${mcpNames.length > 0 ? mcpNames.join(', ') : 'None'}
- Existing skills: ${existingSkillNames.length > 0 ? existingSkillNames.join(', ') : 'None'}

## How to write a good skill

A skill is a markdown file. It should:
1. Start with a clear heading (# Skill Name)
2. Explain WHEN the agent should use this skill
3. Provide step-by-step instructions or rules
4. Reference specific MCP tools the agent has access to (if relevant)
5. Include formatting guidelines for the output
6. Be concise — agents work best with focused, actionable instructions

## Rules
- Write in imperative style ("Do X", "Always Y", "Never Z")
- Reference the agent's MCP tools by name when relevant
- Keep instructions specific and actionable — avoid vague advice
- Use markdown formatting: headings, bullet points, code blocks
- Don't include YAML frontmatter — SlackHive skills are plain markdown
- Don't include the agent's identity info — that's handled by the identity.md skill

## Output format
Respond with ONLY a JSON object (no markdown code fences):
{
  "content": "the full markdown skill content",
  "filename": "suggested-filename.md",
  "category": "00-core"
}

For the filename: use lowercase, hyphens, and .md extension (e.g., "data-workflow.md", "response-rules.md").
For the category: use "00-core" for fundamental behavior, "01-knowledge" for domain knowledge, "02-workflows" for processes.`;
}

/**
 * Build a system prompt for CLAUDE.md (system prompt) generation.
 */
function buildClaudeMdSystemPrompt(
  agentName: string,
  agentPersona: string | null,
  mcpNames: string[],
  existingSkillNames: string[]
): string {
  return `You are an expert at writing system prompts (CLAUDE.md) for SlackHive agents. The CLAUDE.md file is the core instruction set that defines how an agent behaves.

## Context about the target agent
- Agent name: ${agentName}
- Agent persona: ${agentPersona ?? 'Not specified'}
- Connected MCP tools: ${mcpNames.length > 0 ? mcpNames.join(', ') : 'None'}
- Existing skills: ${existingSkillNames.length > 0 ? existingSkillNames.join(', ') : 'None'}

## How to write a good CLAUDE.md

The CLAUDE.md is the agent's core system prompt. It should:
1. Define the agent's identity and role clearly
2. Set communication style and tone
3. List key responsibilities and boundaries
4. Describe how to use connected MCP tools effectively
5. Define output formatting rules (Slack markdown)
6. Include guardrails and error-handling behavior

## Rules
- Write in imperative style directed at the agent ("You are...", "Always...", "Never...")
- Be specific about what the agent should and shouldn't do
- Reference connected MCP tools by name and explain when/how to use them
- Include Slack formatting guidelines (bold, code blocks, lists)
- Keep it focused — the CLAUDE.md should be the single source of truth for agent behavior
- Don't duplicate content that belongs in individual skill files

## Output format
Respond with ONLY a JSON object (no markdown code fences):
{
  "content": "the full CLAUDE.md content"
}`;
}

/**
 * Run a one-shot Claude Code query and return the raw text response.
 */
async function runOneShotQuery(prompt: string): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slackhive-ai-'));
  fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Follow the instructions in the user prompt.', 'utf-8');

  try {
    let resultText = '';

    for await (const message of query({
      prompt,
      options: {
        maxTurns: 1,
        cwd: tmpDir,
        permissionMode: 'acceptEdits',
        tools: [],
        allowedTools: [],
      },
    })) {
      if (message.type === 'assistant' && 'message' in message) {
        const assistantMsg = message as any;
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              resultText += block.text;
            }
          }
        }
      }
    }

    return resultText;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Parse a JSON response from Claude, stripping markdown fences if present.
 */
function parseJsonResponse<T>(text: string, fallback: T): T {
  const cleaned = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

/**
 * Run a one-shot Claude Code query for skill/CLAUDE.md generation.
 */
async function generateSkill(body: GenerateSkillRequest): Promise<{ content: string; filename: string; category: string }> {
  const isClaudeMd = body.target === 'claude-md';
  const systemPrompt = isClaudeMd
    ? buildClaudeMdSystemPrompt(body.agentName, body.agentPersona, body.mcpNames, body.existingSkillNames)
    : buildSkillSystemPrompt(body.agentName, body.agentPersona, body.mcpNames, body.existingSkillNames);

  let userMessage: string;
  if (body.mode === 'generate') {
    userMessage = isClaudeMd
      ? `Generate a CLAUDE.md system prompt based on this description:\n\n${body.description}`
      : `Generate a new skill based on this description:\n\n${body.description}`;
  } else {
    const what = isClaudeMd ? 'CLAUDE.md system prompt' : `skill (${body.filename ?? 'unknown'})`;
    const instructions = body.instructions?.trim()
      ? `\n\nUser's instructions for improvement:\n${body.instructions}`
      : '\n\nMake it more specific, actionable, and well-structured. Keep the same intent but improve clarity and completeness.';
    userMessage = `Improve this existing ${what}:\n\n${body.content}${instructions}`;
  }

  const resultText = await runOneShotQuery(`${systemPrompt}\n\n---\n\n${userMessage}`);
  return parseJsonResponse(resultText, {
    content: resultText,
    filename: body.mode === 'improve' && body.filename ? body.filename : 'new-skill.md',
    category: '00-core',
  });
}

/**
 * Build a system prompt for auditing all skills together.
 */
function buildAuditSystemPrompt(
  agentName: string,
  agentPersona: string | null,
  mcpNames: string[],
): string {
  return `You are an expert at reviewing and optimizing skill sets for SlackHive agents. Your job is to analyze ALL skills together as a cohesive system and find issues.

## Context about the agent
- Agent name: ${agentName}
- Agent persona: ${agentPersona ?? 'Not specified'}
- Connected MCP tools: ${mcpNames.length > 0 ? mcpNames.join(', ') : 'None'}

## What to check

1. **Duplicates** — Instructions that appear in multiple skills. Identify which file should own the instruction and where to remove it.
2. **Contradictions** — Skills that give conflicting guidance (e.g., one says "always use tables" and another says "avoid tables").
3. **CLAUDE.md overlap** — Skills that repeat instructions already in the system prompt (CLAUDE.md). Skills should extend CLAUDE.md, not duplicate it.
4. **Consolidation opportunities** — Small or closely related skills that would be better merged into one.
5. **Quality issues** — Skills that are too vague, too short, or lack actionable instructions.
6. **Gaps** — Missing skills that the agent likely needs based on its role and MCP tools. Only suggest high-value gaps — don't pad the list.

## Output format
Respond with ONLY a JSON object (no markdown code fences):
{
  "summary": "One paragraph overall assessment",
  "score": 85,
  "findings": [
    {
      "type": "duplicate|contradiction|gap|overlap|consolidate|quality",
      "severity": "high|medium|low",
      "title": "Short title",
      "description": "What the issue is and why it matters",
      "affectedFiles": ["category/filename.md"],
      "suggestion": "What to do about it",
      "proposedContent": "Full markdown content if this is a new skill or rewrite (optional)",
      "proposedFilename": "filename.md (only for gap type)",
      "proposedCategory": "00-core (only for gap type)"
    }
  ]
}

Score: 0-100 rating of the overall skill set quality. Be honest — a minimal set with 1-2 skills should score low, a well-organized comprehensive set should score high.

Keep findings actionable and specific. Limit to the top 10 most impactful findings. Prioritize high-severity items.`;
}

/**
 * Run a one-shot Claude Code query to audit all skills together.
 */
async function auditSkills(body: AuditSkillsRequest): Promise<{ summary: string; score: number; findings: AuditFinding[] }> {
  const systemPrompt = buildAuditSystemPrompt(body.agentName, body.agentPersona, body.mcpNames);

  let userMessage = `## CLAUDE.md (System Prompt)\n\n${body.claudeMd || '(empty)'}\n\n## Skills\n\n`;
  for (const skill of body.skills) {
    userMessage += `### ${skill.category}/${skill.filename}\n\n${skill.content}\n\n---\n\n`;
  }
  userMessage += `\nAnalyze all ${body.skills.length} skills together and provide your audit findings.`;

  const resultText = await runOneShotQuery(`${systemPrompt}\n\n---\n\n${userMessage}`);
  return parseJsonResponse(resultText, { summary: resultText, score: 0, findings: [] });
}

/**
 * Parse JSON request body from an IncomingMessage.
 */
function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Start the internal HTTP API server.
 */
export function startInternalApi(): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS for web UI calls
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // --- Skill generation ---

    if (req.method === 'POST' && req.url === '/generate-skill') {
      try {
        const body = await parseBody(req) as GenerateSkillRequest;

        if (!body.mode || !['generate', 'improve'].includes(body.mode)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'mode must be "generate" or "improve"' }));
          return;
        }
        if (body.mode === 'generate' && !body.description) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'description is required for generate mode' }));
          return;
        }
        if (body.mode === 'improve' && !body.content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'content is required for improve mode' }));
          return;
        }

        logger.info('[internal-api] Generating skill', { mode: body.mode, agent: body.agentName });
        const result = await generateSkill(body);
        logger.info('[internal-api] Skill generated', { filename: result.filename });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        logger.error('[internal-api] Skill generation failed', { error: (err as Error).message });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // --- Skill audit ---

    if (req.method === 'POST' && req.url === '/audit-skills') {
      try {
        const body = await parseBody(req) as AuditSkillsRequest;

        if (!body.skills || !Array.isArray(body.skills) || body.skills.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'At least one skill is required for audit' }));
          return;
        }

        logger.info('[internal-api] Auditing skills', { agent: body.agentName, skillCount: body.skills.length });
        const result = await auditSkills(body);
        logger.info('[internal-api] Audit complete', { findings: result.findings.length, score: result.score });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        logger.error('[internal-api] Skill audit failed', { error: (err as Error).message });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`[internal-api] Listening on port ${PORT}`);
  });

  return server;
}
