/**
 * @fileoverview Debug endpoint for the activity dashboard data layer.
 *
 * Dumps the last 20 tasks (with activities and tool calls) as JSON so PR A
 * can be verified end-to-end without any UI. Gated behind `guardAdmin` so
 * only admins can call it, and useful only while the `ACTIVITY_DASHBOARD`
 * feature flag is on — otherwise the tables stay empty.
 *
 * @module web/api/activity/debug
 */

import { NextRequest, NextResponse } from 'next/server';
import { listTasks, getTaskWithDetails } from '@slackhive/shared';
import { guardAdmin } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

/**
 * Returns `{ flag, tasks: [{ task, activities, ... }] }`. Merges the three
 * kanban columns together (oldest 20 of each) so a single curl confirms
 * writes are reaching `tasks`, `activities`, and `tool_calls`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = guardAdmin(req);
  if (denied) return denied;

  const flag = process.env.ACTIVITY_DASHBOARD === '1';
  const [active, recent, errored] = await Promise.all([
    listTasks('active', {}, 20, null),
    listTasks('recent', {}, 20, null),
    listTasks('errored', {}, 20, null),
  ]);

  const seen = new Set<string>();
  const ordered = [...active.tasks, ...errored.tasks, ...recent.tasks].filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  }).slice(0, 20);

  const details = await Promise.all(ordered.map(t => getTaskWithDetails(t.id)));

  return NextResponse.json({
    flag,
    counts: {
      active: active.tasks.length,
      recent: recent.tasks.length,
      errored: errored.tasks.length,
    },
    tasks: details.filter(Boolean),
  });
}
