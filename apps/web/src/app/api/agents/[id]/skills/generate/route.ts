/**
 * @fileoverview AI-powered skill generation endpoint.
 *
 * POST /api/agents/[id]/skills/generate — Generate or improve a skill using Claude Code
 *
 * Proxies the request to the runner's internal API, which uses the Claude Code SDK
 * (same auth as all agents — API key or subscription).
 *
 * Body:
 *   mode: 'generate' | 'improve'
 *   description?: string   — Natural language description (for generate mode)
 *   content?: string        — Existing skill content (for improve mode)
 *   filename?: string       — Skill filename for context (for improve mode)
 *
 * Returns: { content: string, filename: string, category: string }
 *
 * @module web/api/agents/[id]/skills/generate
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentById, getAgentSkills, getAgentMcpServers } from '@/lib/db';
import { guardAgentWrite } from '@/lib/api-guard';

type RouteParams = { params: Promise<{ id: string }> };

const RUNNER_API_URL = process.env.RUNNER_API_URL ?? 'http://runner:3002';

interface GenerateRequest {
  mode: 'generate' | 'improve';
  target?: 'skill' | 'claude-md';
  description?: string;
  content?: string;
  filename?: string;
  instructions?: string;
}

/**
 * POST /api/agents/[id]/skills/generate
 */
export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const denied = await guardAgentWrite(req, id);
    if (denied) return denied;

    const body = (await req.json()) as GenerateRequest;
    if (!body.mode || !['generate', 'improve'].includes(body.mode)) {
      return NextResponse.json({ error: 'mode must be "generate" or "improve"' }, { status: 400 });
    }
    if (body.mode === 'generate' && !body.description) {
      return NextResponse.json({ error: 'description is required for generate mode' }, { status: 400 });
    }
    if (body.mode === 'improve' && !body.content) {
      return NextResponse.json({ error: 'content is required for improve mode' }, { status: 400 });
    }

    // Gather agent context to send to the runner
    const [agent, skills, mcps] = await Promise.all([
      getAgentById(id),
      getAgentSkills(id),
      getAgentMcpServers(id),
    ]);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const mcpNames = mcps.map((m: { name: string }) => m.name);
    const existingSkillNames = skills.map((s: { category: string; filename: string }) => `${s.category}/${s.filename}`);

    // Call the runner's internal API (uses Claude Code SDK — same auth as agents)
    const response = await fetch(`${RUNNER_API_URL}/generate-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        agentName: agent.name,
        agentPersona: agent.persona,
        mcpNames,
        existingSkillNames,
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({ error: 'Runner unavailable' }));
      return NextResponse.json(
        { error: errBody.error ?? `Skill generation failed (${response.status})` },
        { status: response.status >= 500 ? 502 : response.status },
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (err) {
    const message = (err as Error).message;
    // Provide a helpful error when the runner is not reachable
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      return NextResponse.json(
        { error: 'Cannot reach the runner service. Make sure it is running.' },
        { status: 503 },
      );
    }
    console.error('[skill-generate] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
