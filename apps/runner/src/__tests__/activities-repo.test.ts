/**
 * @fileoverview Unit tests for the activities-repo writer + reader.
 *
 * Uses a throwaway on-disk SQLite DB per test (in a temp dir) so we run
 * against the real adapter, including the UUID triggers and CHECK
 * constraints — mocks would hide schema-level bugs we care about here.
 *
 * @module runner/__tests__/activities-repo.test
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSqliteAdapter,
  setDb,
  getDb,
  closeDb,
  upsertTask,
  beginActivity,
  finishActivity,
  beginToolCall,
  finishToolCall,
  listTasks,
  getTaskWithDetails,
  countInProgressByAgent,
} from '@slackhive/shared';

let dbPath: string;

async function seedAgent(id = randomUUID()): Promise<string> {
  const db = getDb();
  await db.query(
    `INSERT INTO agents (id, slug, name, persona, description, model)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, `slug-${id.slice(0, 8)}`, 'Test Agent', null, null, 'claude-opus-4-7'],
  );
  return id;
}

beforeEach(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-repo-'));
  dbPath = path.join(tmpDir, 'data.db');
  const adapter = createSqliteAdapter(dbPath);
  setDb(adapter);
});

afterEach(async () => {
  await closeDb();
  try {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe('upsertTask', () => {
  it('inserts on first call and no-ops on repeat', async () => {
    const id1 = await upsertTask({
      platform: 'slack',
      channelId: 'C1',
      threadTs: '100.0',
      initiatorUserId: 'U1',
      openingPreview: 'hello',
    });
    const id2 = await upsertTask({
      platform: 'slack',
      channelId: 'C1',
      threadTs: '100.0',
      initiatorUserId: 'U_different',
      openingPreview: 'second call',
    });
    expect(id1).toBe(id2);
    expect(id1).toBe('slack:C1:100.0');

    const { rows } = await getDb().query(`SELECT * FROM tasks WHERE id = $1`, [id1]);
    expect(rows).toHaveLength(1);
    // First-insert fields win
    expect(rows[0].initiator_user_id).toBe('U1');
    expect(rows[0].summary).toBe('hello');
  });

  it('truncates long previews to 200 chars', async () => {
    const long = 'x'.repeat(500);
    const id = await upsertTask({
      platform: 'slack',
      channelId: 'C2',
      threadTs: '200.0',
      openingPreview: long,
    });
    const { rows } = await getDb().query(`SELECT summary FROM tasks WHERE id = $1`, [id]);
    expect((rows[0].summary as string).length).toBeLessThanOrEqual(200);
    expect((rows[0].summary as string).endsWith('\u2026')).toBe(true);
  });

  it('distinguishes tasks across platforms', async () => {
    const slack = await upsertTask({ platform: 'slack', channelId: 'C1', threadTs: '1.0' });
    const telegram = await upsertTask({ platform: 'telegram', channelId: 'C1', threadTs: '1.0' });
    expect(slack).not.toBe(telegram);
  });
});

describe('beginActivity + finishActivity', () => {
  it('increments the task activity_count and bumps last_activity_at', async () => {
    const agentId = await seedAgent();
    const taskId = await upsertTask({ platform: 'slack', channelId: 'C1', threadTs: '1.0' });

    const before = await getDb().query(`SELECT activity_count FROM tasks WHERE id = $1`, [taskId]);
    expect(Number(before.rows[0].activity_count)).toBe(0);

    const activityId = await beginActivity({
      taskId,
      agentId,
      platform: 'slack',
      initiatorKind: 'user',
      initiatorUserId: 'U1',
      messageRef: 'M1',
      messagePreview: 'hi',
    });
    expect(activityId).toMatch(/^[0-9a-f-]{36}$/i);

    const afterBegin = await getDb().query(`SELECT activity_count FROM tasks WHERE id = $1`, [taskId]);
    expect(Number(afterBegin.rows[0].activity_count)).toBe(1);

    const openRow = await getDb().query(`SELECT * FROM activities WHERE id = $1`, [activityId]);
    expect(openRow.rows[0].status).toBe('in_progress');
    expect(openRow.rows[0].finished_at).toBeNull();

    await finishActivity(activityId, 'done');
    const doneRow = await getDb().query(`SELECT * FROM activities WHERE id = $1`, [activityId]);
    expect(doneRow.rows[0].status).toBe('done');
    expect(doneRow.rows[0].finished_at).toBeTruthy();
  });

  it('finishing with error closes dangling in_progress tool_calls', async () => {
    const agentId = await seedAgent();
    const taskId = await upsertTask({ platform: 'slack', channelId: 'C1', threadTs: '1.0' });
    const activityId = await beginActivity({
      taskId, agentId, platform: 'slack', initiatorKind: 'user',
    });
    const tcId = await beginToolCall({ activityId, toolName: 'mcp__redshift__query', argsPreview: '{"q":"select 1"}' });

    await finishActivity(activityId, 'error', 'boom');

    const tc = await getDb().query(`SELECT * FROM tool_calls WHERE id = $1`, [tcId]);
    expect(tc.rows[0].status).toBe('error');
    expect(tc.rows[0].finished_at).toBeTruthy();
  });
});

describe('tool_call lifecycle', () => {
  it('increments activity.tool_call_count and records status', async () => {
    const agentId = await seedAgent();
    const taskId = await upsertTask({ platform: 'slack', channelId: 'C1', threadTs: '1.0' });
    const activityId = await beginActivity({
      taskId, agentId, platform: 'slack', initiatorKind: 'user',
    });

    const tc1 = await beginToolCall({ activityId, toolName: 'Read' });
    const tc2 = await beginToolCall({ activityId, toolName: 'Bash' });
    await finishToolCall(tc1, 'ok', 'file contents');
    await finishToolCall(tc2, 'error', 'exit 1');

    const count = await getDb().query(`SELECT tool_call_count FROM activities WHERE id = $1`, [activityId]);
    expect(Number(count.rows[0].tool_call_count)).toBe(2);

    const rows = await getDb().query(
      `SELECT tool_name, status FROM tool_calls WHERE activity_id = $1 ORDER BY started_at`,
      [activityId],
    );
    expect(rows.rows.map(r => [r.tool_name, r.status])).toEqual([
      ['Read', 'ok'],
      ['Bash', 'error'],
    ]);
  });
});

describe('listTasks', () => {
  it('buckets tasks into active / recent / errored by activity status', async () => {
    const agentId = await seedAgent();

    // Task A: active (one in_progress activity)
    const a = await upsertTask({ platform: 'slack', channelId: 'C1', threadTs: 'A' });
    await beginActivity({ taskId: a, agentId, platform: 'slack', initiatorKind: 'user' });

    // Task B: recent (one done activity, no error, no in_progress)
    const b = await upsertTask({ platform: 'slack', channelId: 'C1', threadTs: 'B' });
    const bAct = await beginActivity({ taskId: b, agentId, platform: 'slack', initiatorKind: 'user' });
    await finishActivity(bAct, 'done');

    // Task C: errored
    const c = await upsertTask({ platform: 'slack', channelId: 'C1', threadTs: 'C' });
    const cAct = await beginActivity({ taskId: c, agentId, platform: 'slack', initiatorKind: 'user' });
    await finishActivity(cAct, 'error', 'boom');

    const active = await listTasks('active');
    const recent = await listTasks('recent');
    const errored = await listTasks('errored');

    expect(active.tasks.map(t => t.id)).toEqual([a]);
    expect(recent.tasks.map(t => t.id)).toEqual([b]);
    expect(errored.tasks.map(t => t.id)).toEqual([c]);
  });

  it('paginates via cursor', async () => {
    const agentId = await seedAgent();
    for (let i = 0; i < 5; i++) {
      const id = await upsertTask({ platform: 'slack', channelId: 'C', threadTs: `t${i}` });
      const act = await beginActivity({ taskId: id, agentId, platform: 'slack', initiatorKind: 'user' });
      await finishActivity(act, 'done');
    }

    const page1 = await listTasks('recent', {}, 2, null);
    expect(page1.tasks).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listTasks('recent', {}, 2, page1.nextCursor);
    expect(page2.tasks).toHaveLength(2);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await listTasks('recent', {}, 2, page2.nextCursor);
    expect(page3.tasks).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    const allIds = [...page1.tasks, ...page2.tasks, ...page3.tasks].map(t => t.id);
    // No duplicates and no missed rows across pages.
    expect(new Set(allIds).size).toBe(5);
  });

  it('filters by agentId', async () => {
    const a1 = await seedAgent();
    const a2 = await seedAgent();

    const t1 = await upsertTask({ platform: 'slack', channelId: 'C', threadTs: 't1' });
    await beginActivity({ taskId: t1, agentId: a1, platform: 'slack', initiatorKind: 'user' });

    const t2 = await upsertTask({ platform: 'slack', channelId: 'C', threadTs: 't2' });
    await beginActivity({ taskId: t2, agentId: a2, platform: 'slack', initiatorKind: 'user' });

    const forA1 = await listTasks('active', { agentId: a1 });
    expect(forA1.tasks.map(t => t.id)).toEqual([t1]);

    const forA2 = await listTasks('active', { agentId: a2 });
    expect(forA2.tasks.map(t => t.id)).toEqual([t2]);
  });
});

describe('getTaskWithDetails', () => {
  it('returns the task with activities and their tool_calls nested', async () => {
    const agentId = await seedAgent();
    const taskId = await upsertTask({ platform: 'slack', channelId: 'C', threadTs: 't' });
    const act = await beginActivity({ taskId, agentId, platform: 'slack', initiatorKind: 'user' });
    const tc = await beginToolCall({ activityId: act, toolName: 'Bash' });
    await finishToolCall(tc, 'ok', 'hello');
    await finishActivity(act, 'done');

    const details = await getTaskWithDetails(taskId);
    expect(details?.task.id).toBe(taskId);
    expect(details?.activities).toHaveLength(1);
    expect(details?.activities[0].toolCalls).toHaveLength(1);
    expect(details?.activities[0].toolCalls[0].toolName).toBe('Bash');
  });

  it('returns null for unknown task id', async () => {
    const details = await getTaskWithDetails('does-not-exist');
    expect(details).toBeNull();
  });
});

describe('countInProgressByAgent', () => {
  it('sums in_progress activities per agent', async () => {
    const a1 = await seedAgent();
    const a2 = await seedAgent();
    const t = await upsertTask({ platform: 'slack', channelId: 'C', threadTs: 't' });

    const open1 = await beginActivity({ taskId: t, agentId: a1, platform: 'slack', initiatorKind: 'user' });
    await beginActivity({ taskId: t, agentId: a1, platform: 'slack', initiatorKind: 'agent' });
    const open3 = await beginActivity({ taskId: t, agentId: a2, platform: 'slack', initiatorKind: 'agent' });

    const counts = await countInProgressByAgent();
    expect(counts[a1]).toBe(2);
    expect(counts[a2]).toBe(1);

    await finishActivity(open1, 'done');
    await finishActivity(open3, 'done');

    const after = await countInProgressByAgent();
    expect(after[a1]).toBe(1);
    expect(after[a2]).toBeUndefined();
  });
});

describe('cascade delete', () => {
  it('deleting a task cascades to activities and tool_calls', async () => {
    const agentId = await seedAgent();
    const taskId = await upsertTask({ platform: 'slack', channelId: 'C', threadTs: 't' });
    const act = await beginActivity({ taskId, agentId, platform: 'slack', initiatorKind: 'user' });
    await beginToolCall({ activityId: act, toolName: 'Read' });

    await getDb().query(`DELETE FROM tasks WHERE id = $1`, [taskId]);

    const actRows = await getDb().query(`SELECT COUNT(*) AS n FROM activities WHERE task_id = $1`, [taskId]);
    expect(Number(actRows.rows[0].n)).toBe(0);
    const tcRows = await getDb().query(`SELECT COUNT(*) AS n FROM tool_calls WHERE activity_id = $1`, [act]);
    expect(Number(tcRows.rows[0].n)).toBe(0);
  });
});
