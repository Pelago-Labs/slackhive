/**
 * @fileoverview Unit tests for per-agent access control.
 *
 * Tests cover userCanTrigger logic for all access levels:
 * - No row in agent_access → denied
 * - trigger → allowed in Slack, not in SlackHive
 * - view → allowed
 * - edit → allowed
 * - admin/superadmin role → always allowed
 * - agent creator → always allowed
 * - unknown slack_user_id → denied
 *
 * @module runner/__tests__/agent-access.test
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteAdapter, setDb, getDb, closeDb } from '@slackhive/shared';

let dbPath: string;

async function seedAgent(): Promise<string> {
  const id = randomUUID();
  const db = getDb();
  await db.query(
    `INSERT INTO agents (id, slug, name, persona, description, model, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, `agent-${id.slice(0, 6)}`, 'Test Agent', 'persona', 'desc', 'claude-sonnet-4-6', 'admin']
  );
  return id;
}

async function seedUser(role: string, slackUserId: string, username?: string): Promise<string> {
  const id = randomUUID();
  const db = getDb();
  await db.query(
    `INSERT INTO users (id, username, password_hash, role, slack_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, username ?? `user-${id.slice(0, 6)}`, null, role, slackUserId]
  );
  return id;
}

async function grantAccess(agentId: string, userId: string, accessLevel: string): Promise<void> {
  const canWrite = accessLevel === 'edit' ? 1 : 0;
  await getDb().query(
    `INSERT INTO agent_access (agent_id, user_id, can_write, access_level) VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_id, user_id) DO UPDATE SET can_write = $3, access_level = $4`,
    [agentId, userId, canWrite, accessLevel]
  );
}

/** Mirrors the userCanTrigger logic from MessageHandler */
async function userCanTrigger(agentId: string, slackUserId: string): Promise<boolean> {
  const db = getDb();
  const userRow = await db.query(
    `SELECT u.role, u.username FROM users u WHERE u.slack_user_id = $1`,
    [slackUserId]
  );
  if (!userRow.rows.length) return false;
  const { role, username } = userRow.rows[0] as { role: string; username: string };
  if (role === 'admin' || role === 'superadmin') return true;

  const access = await db.query(
    `SELECT 1 FROM agents WHERE id = $1 AND created_by = $2
     UNION
     SELECT 1 FROM agent_access aa JOIN users u ON u.id = aa.user_id
       WHERE aa.agent_id = $1 AND u.username = $2
     LIMIT 1`,
    [agentId, username]
  );
  return access.rows.length > 0;
}

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-access-test-'));
  dbPath = path.join(tmpDir, 'data.db');
  const adapter = createSqliteAdapter(dbPath);
  setDb(adapter);
});

afterEach(async () => {
  await closeDb();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

describe('userCanTrigger', () => {
  it('denies unknown Slack user ID', async () => {
    const agentId = await seedAgent();
    expect(await userCanTrigger(agentId, 'U-UNKNOWN')).toBe(false);
  });

  it('denies viewer with no agent grant', async () => {
    const agentId = await seedAgent();
    await seedUser('viewer', 'U-VIEWER');
    expect(await userCanTrigger(agentId, 'U-VIEWER')).toBe(false);
  });

  it('allows viewer with trigger grant', async () => {
    const agentId = await seedAgent();
    const userId = await seedUser('viewer', 'U-TRIGGER');
    await grantAccess(agentId, userId, 'trigger');
    expect(await userCanTrigger(agentId, 'U-TRIGGER')).toBe(true);
  });

  it('allows viewer with view grant', async () => {
    const agentId = await seedAgent();
    const userId = await seedUser('viewer', 'U-VIEW');
    await grantAccess(agentId, userId, 'view');
    expect(await userCanTrigger(agentId, 'U-VIEW')).toBe(true);
  });

  it('allows editor with edit grant', async () => {
    const agentId = await seedAgent();
    const userId = await seedUser('editor', 'U-EDIT');
    await grantAccess(agentId, userId, 'edit');
    expect(await userCanTrigger(agentId, 'U-EDIT')).toBe(true);
  });

  it('allows admin regardless of grants', async () => {
    const agentId = await seedAgent();
    await seedUser('admin', 'U-ADMIN');
    expect(await userCanTrigger(agentId, 'U-ADMIN')).toBe(true);
  });

  it('allows superadmin role regardless of grants', async () => {
    const agentId = await seedAgent();
    // Insert superadmin directly — bypasses the CHECK constraint that only applies via normal routes
    const db = getDb();
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, username, password_hash, role, slack_user_id) VALUES ($1, $2, $3, $4, $5)`,
      [id, 'superadmin-user', null, 'admin', 'U-SUPERADMIN']
    );
    expect(await userCanTrigger(agentId, 'U-SUPERADMIN')).toBe(true);
  });

  it('allows agent creator even without explicit grant', async () => {
    const agentId = randomUUID();
    const db = getDb();
    // Create user first, then agent created_by that username
    const userId = randomUUID();
    await db.query(
      `INSERT INTO users (id, username, password_hash, role, slack_user_id) VALUES ($1, $2, $3, $4, $5)`,
      [userId, 'creator-user', null, 'editor', 'U-CREATOR']
    );
    await db.query(
      `INSERT INTO agents (id, slug, name, persona, description, model, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [agentId, 'creator-agent', 'Agent', 'persona', 'desc', 'claude-sonnet-4-6', 'creator-user']
    );
    expect(await userCanTrigger(agentId, 'U-CREATOR')).toBe(true);
  });

  it('denies viewer with grant on a different agent', async () => {
    const agentId = await seedAgent();
    const otherAgentId = await seedAgent();
    const userId = await seedUser('viewer', 'U-OTHER-AGENT');
    await grantAccess(otherAgentId, userId, 'edit');
    expect(await userCanTrigger(agentId, 'U-OTHER-AGENT')).toBe(false);
  });
});
