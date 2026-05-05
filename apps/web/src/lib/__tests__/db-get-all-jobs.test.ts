/**
 * @fileoverview Tests for getAllJobs agentIds filtering.
 *
 * Verifies that:
 * - null agentIds returns all jobs (admin/superadmin path)
 * - empty array returns immediately without querying
 * - non-empty array generates correct WHERE IN clause
 *
 * Uses a fake DbAdapter — no real database required.
 *
 * @module web/lib/__tests__/db-get-all-jobs.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setDb, type DbAdapter, type DbResult } from '@slackhive/shared';
import { getAllJobs } from '@/lib/db';

const mockQuery = vi.fn<(sql: string, params?: unknown[]) => Promise<DbResult>>();

const fakeAdapter: DbAdapter = {
  query: mockQuery,
  transaction: async (fn) => fn(fakeAdapter),
  close: async () => {},
  type: 'sqlite',
};

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  setDb(fakeAdapter);
});

describe('getAllJobs', () => {
  it('returns all jobs (no agent filter) when agentIds is null', async () => {
    await getAllJobs(null);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('agent_id IN');
    expect(sql).toContain('scheduled_jobs');
  });

  it('returns all jobs (no agent filter) when agentIds is undefined', async () => {
    await getAllJobs(undefined);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('agent_id IN');
  });

  it('returns empty array immediately without querying when agentIds is []', async () => {
    const result = await getAllJobs([]);
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('generates WHERE agent_id IN clause for a single agent ID', async () => {
    await getAllJobs(['agent-1']);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('agent_id IN');
    expect(params).toContain('agent-1');
  });

  it('generates correct number of placeholders for multiple agent IDs', async () => {
    await getAllJobs(['agent-1', 'agent-2', 'agent-3']);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('agent_id IN');
    expect(params).toEqual(expect.arrayContaining(['agent-1', 'agent-2', 'agent-3']));
    expect((params as unknown[]).length).toBe(3);
  });

  it('returns mapped job rows from query results', async () => {
    const now = new Date().toISOString();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'job-1', agent_id: 'agent-1', name: 'Test Job',
        prompt: 'Do something', cron_schedule: '0 8 * * *',
        target_type: 'channel', target_id: 'C123', enabled: 1,
        created_by: 'alice', created_at: now, updated_at: now,
        lr_id: null,
      }],
      rowCount: 1,
    });
    const jobs = await getAllJobs(null);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('job-1');
    expect(jobs[0].lastRun).toBeUndefined();
  });
});
