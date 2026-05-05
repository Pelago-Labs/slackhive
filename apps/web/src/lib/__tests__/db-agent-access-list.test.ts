/**
 * @fileoverview Tests for listAccessibleAgentIds and listWritableAgentIds.
 *
 * Verifies that:
 * - admins/superadmins get null (all agents)
 * - viewers see only view/edit agents (not trigger-only)
 * - editors/creators can create jobs for edit-level agents only
 *
 * Uses a fake DbAdapter — no real database required.
 *
 * @module web/lib/__tests__/db-agent-access-list.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setDb, type DbAdapter, type DbResult } from '@slackhive/shared';
import { listAccessibleAgentIds, listWritableAgentIds } from '@/lib/db';

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

// ─── listAccessibleAgentIds ───────────────────────────────────────────────────

describe('listAccessibleAgentIds', () => {
  it('returns null for admin (all agents)', async () => {
    const result = await listAccessibleAgentIds('any', 'admin');
    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns null for superadmin', async () => {
    const result = await listAccessibleAgentIds('any', 'superadmin');
    expect(result).toBeNull();
  });

  it('queries view/edit access_levels for non-admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-1' }, { id: 'agent-2' }], rowCount: 2 });
    const result = await listAccessibleAgentIds('alice', 'viewer');
    expect(result).toEqual(['agent-1', 'agent-2']);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("access_level IN ('view', 'edit')");
    expect(params).toContain('alice');
  });

  it('does NOT include trigger-only agents', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await listAccessibleAgentIds('alice', 'viewer');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("'trigger'");
  });

  it('includes agents created by the user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-3' }], rowCount: 1 });
    await listAccessibleAgentIds('alice', 'editor');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('created_by');
    expect(params).toContain('alice');
  });
});

// ─── listWritableAgentIds ─────────────────────────────────────────────────────

describe('listWritableAgentIds', () => {
  it('returns null for admin', async () => {
    const result = await listWritableAgentIds('any', 'admin');
    expect(result).toBeNull();
  });

  it('returns null for superadmin', async () => {
    const result = await listWritableAgentIds('any', 'superadmin');
    expect(result).toBeNull();
  });

  it('queries only edit access_level for non-admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-5' }], rowCount: 1 });
    const result = await listWritableAgentIds('bob', 'editor');
    expect(result).toEqual(['agent-5']);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("access_level = 'edit'");
    expect(params).toContain('bob');
  });

  it('does NOT include view-only agents', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await listWritableAgentIds('bob', 'editor');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("'view'");
  });

  it('returns empty array when user has no edit grants', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await listWritableAgentIds('viewer-only', 'viewer');
    expect(result).toEqual([]);
  });

  it('includes agents created by the user even without explicit grant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-6' }], rowCount: 1 });
    await listWritableAgentIds('creator', 'editor');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('created_by');
  });
});
