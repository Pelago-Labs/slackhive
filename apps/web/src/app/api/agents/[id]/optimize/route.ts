/**
 * @fileoverview POST /api/agents/[id]/optimize — trigger instruction optimization
 *               GET  /api/agents/[id]/optimize?requestId=xxx — poll for result
 *
 * Routes optimization through the runner via event bus. The runner calls Claude
 * SDK to analyze the agent's system prompt + skills and suggest improvements.
 *
 * @module web/api/agents/[id]/optimize
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAgentById, getSetting, setSetting } from '@/lib/db';
import { getEventBus } from '@slackhive/shared';

export const dynamic = 'force-dynamic';

/**
 * POST — trigger optimization.
 * Returns { requestId } that the client uses to poll for results.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const agent = await getAgentById(id);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const requestId = randomUUID();

  // Store initial status
  await setSetting(`optimize:${requestId}`, JSON.stringify({ status: 'pending' }));

  // Publish optimize event to runner
  try {
    const bus = getEventBus();
    await bus.publish({ type: 'optimize', agentId: id, requestId });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to reach runner. Is it running?' },
      { status: 503 }
    );
  }

  return NextResponse.json({ requestId });
}

/**
 * GET — poll for optimization result.
 * Returns the stored result JSON or { status: 'pending' }.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const requestId = req.nextUrl.searchParams.get('requestId');
  if (!requestId) {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 });
  }

  const raw = await getSetting(`optimize:${requestId}`);
  if (!raw) {
    return NextResponse.json({ status: 'pending' });
  }

  try {
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ status: 'error', error: 'Invalid result data' });
  }
}
