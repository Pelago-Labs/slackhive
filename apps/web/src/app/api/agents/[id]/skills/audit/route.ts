/**
 * @fileoverview AI-powered skill audit endpoint.
 *
 * POST /api/agents/[id]/skills/audit — Audit all skills together for quality issues
 *
 * Sends all skills + CLAUDE.md to the runner for holistic analysis.
 * Returns findings: duplicates, contradictions, gaps, quality issues.
 *
 * @module web/api/agents/[id]/skills/audit
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentById, getAgentSkills, getAgentMcpServers } from '@/lib/db';
import { guardAgentWrite } from '@/lib/api-guard';

type RouteParams = { params: Promise<{ id: string }> };

const RUNNER_API_URL = process.env.RUNNER_API_URL ?? 'http://runner:3002';

/**
 * POST /api/agents/[id]/skills/audit
 */
export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const denied = await guardAgentWrite(req, id);
    if (denied) return denied;

    const [agent, skills, mcps] = await Promise.all([
      getAgentById(id),
      getAgentSkills(id),
      getAgentMcpServers(id),
    ]);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (skills.length === 0) {
      return NextResponse.json({ error: 'No skills to audit — create some skills first' }, { status: 400 });
    }

    const mcpNames = mcps.map((m: { name: string }) => m.name);

    const response = await fetch(`${RUNNER_API_URL}/audit-skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: agent.name,
        agentPersona: agent.persona,
        mcpNames,
        claudeMd: agent.claudeMd ?? '',
        skills: skills.map((s: { category: string; filename: string; content: string }) => ({
          category: s.category,
          filename: s.filename,
          content: s.content,
        })),
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({ error: 'Runner unavailable' }));
      return NextResponse.json(
        { error: errBody.error ?? `Audit failed (${response.status})` },
        { status: response.status >= 500 ? 502 : response.status },
      );
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      return NextResponse.json(
        { error: 'Cannot reach the runner service. Make sure it is running.' },
        { status: 503 },
      );
    }
    console.error('[skill-audit] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
