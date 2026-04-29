/**
 * @fileoverview API for the date spoofer — lets admins override the "current"
 * date seen by agents and the scheduler without restarting the process.
 *
 * GET    /api/system/spoof-date  → { spoofDate: ISO string | null }
 * PUT    /api/system/spoof-date  → body { date: ISO string } → sets spoof
 * DELETE /api/system/spoof-date  → clears spoof, restores real system clock
 *
 * The web process persists the value to the `settings` table so it survives
 * restarts, and also notifies the runner process via its internal HTTP API so
 * agents pick it up immediately without a restart.
 *
 * @module web/api/system/spoof-date
 */

import { NextRequest, NextResponse } from 'next/server';
import { guardAdmin } from '@/lib/api-guard';
import { setSetting, getSetting, deleteSetting } from '@/lib/db';

export const dynamic = 'force-dynamic';

const SETTING_KEY = 'spoof_date';

async function notifyRunner(method: 'PUT' | 'DELETE', date?: string): Promise<void> {
  const port = process.env.RUNNER_INTERNAL_PORT ?? '3002';
  try {
    await fetch(`http://127.0.0.1:${port}/spoof-date`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'PUT' ? { body: JSON.stringify({ date }) } : {}),
    });
  } catch {
    // Runner may not be running — that's fine, the DB value survives
  }
}

/**
 * GET /api/system/spoof-date
 * Returns the active spoof date (null if not set).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const value = await getSetting(SETTING_KEY);
  return NextResponse.json({ spoofDate: value ?? null });
}

/**
 * PUT /api/system/spoof-date
 * Body: { date: string } — any ISO-8601 or date string parseable by Date().
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const body = await req.json() as { date?: string };
  if (!body.date) {
    return NextResponse.json({ error: 'date is required' }, { status: 400 });
  }

  const d = new Date(body.date);
  if (isNaN(d.getTime())) {
    return NextResponse.json({ error: 'Invalid date string' }, { status: 400 });
  }

  const iso = d.toISOString();
  await setSetting(SETTING_KEY, iso);
  await notifyRunner('PUT', iso);

  return NextResponse.json({ ok: true, spoofDate: iso });
}

/**
 * DELETE /api/system/spoof-date
 * Clears the spoof date — system clock is used from this point on.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const denied = guardAdmin(req);
  if (denied) return denied;

  await deleteSetting(SETTING_KEY);
  await notifyRunner('DELETE');

  return NextResponse.json({ ok: true, spoofDate: null });
}
