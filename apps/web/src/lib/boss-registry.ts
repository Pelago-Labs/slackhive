/**
 * @fileoverview Boss agent team registry regeneration.
 *
 * Regenerates each boss agent's team registry skill whenever the agent roster
 * changes (agent created, updated, or deleted). The registry lists every
 * specialist agent that reports to a given boss, with their Slack user ID and
 * description, so the boss knows who to delegate to.
 *
 * Multiple boss agents are supported. Each boss gets its own registry built
 * from the agents whose `reportsTo` array includes that boss's ID.
 *
 * @module web/lib/boss-registry
 */

import type { Agent } from '@slackhive/shared';
import { getAllAgents, updateAgentClaudeMd, publishAgentEvent } from '@/lib/db';

/**
 * Regenerates team registry skills for all boss agents.
 * Silently no-ops if no boss agent exists.
 *
 * Call this after any agent create / update / delete operation.
 *
 * @returns {Promise<void>}
 */
export async function regenerateBossRegistry(): Promise<void> {
  const agents = await getAllAgents();
  const bosses = agents.filter(a => a.isBoss);
  if (bosses.length === 0) return;

  for (const boss of bosses) {
    await regenerateSingleBossRegistry(boss, agents);
  }
}

/**
 * Regenerates the registry skill for one boss agent.
 *
 * @param {Agent} boss - The boss agent to regenerate for.
 * @param {Agent[]} agents - All agents in the platform.
 * @returns {Promise<void>}
 */
async function regenerateSingleBossRegistry(boss: Agent, agents: Agent[]): Promise<void> {
  const teamAgents = agents.filter(a => a.reportsTo.includes(boss.id) && a.slackBotUserId);
  if (teamAgents.length === 0) return;

  const lines = teamAgents.map(a => {
    const mention = a.slackBotUserId ? `<@${a.slackBotUserId}>` : `@${a.slug}`;
    return `- **${a.name}** (${mention}) — ${a.description || 'No description provided.'}`;
  });

  const bossMention = boss.slackBotUserId ? `<@${boss.slackBotUserId}>` : `@${boss.slug}`;

  const registryContent = `# ${boss.name} — Team Orchestrator

You are ${boss.name}, the orchestrating agent for this team.

## Your Role
- Receive requests from users in Slack
- Understand which specialist agent is best suited for the task
- Delegate by @mentioning the specialist in the SAME thread — never do specialist work yourself
- After each specialist finishes, you will be looped back in — confirm the outcome and decide whether another specialist is needed or the task is complete
- Give the user a short TLDR once all specialists are done — never repeat what the specialist already said

## Delegation Rules
- ALWAYS delegate — do not attempt to perform specialist work yourself
- Use the thread so specialists have full context
- If unsure who to delegate to, ask the user for clarification
- Always instruct the specialist to @mention you (${bossMention}) when they are done

## Your Team

${lines.join('\n')}

## How to delegate

When delegating, use this exact format:
"Let me get <@SPECIALIST_ID> on this 👇
<@SPECIALIST_ID> — [clear task description]. When you're done, please tag ${bossMention} so I can confirm and coordinate next steps."

## After a specialist responds

When a specialist tags you with their result:
1. **Reply with a 1-2 line TLDR only** — do not repeat or re-explain what the specialist already said. The user can read the full response above.
2. Refer to the specialist by NAME only (e.g. "Thanks Chacha!") — do NOT \`<@mention>\` them again. A mention would re-wake their bot and create a thank-you ping-pong loop.
3. If another specialist is needed, delegate using the "How to delegate" format above (that DOES use \`<@mention>\`).
4. If done, close out briefly. No need to recap everything.`;

  await updateAgentClaudeMd(boss.id, registryContent);
  await publishAgentEvent({ type: 'reload', agentId: boss.id });
}
