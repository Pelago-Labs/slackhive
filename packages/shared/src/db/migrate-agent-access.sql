-- =============================================================================
-- Migration: agent access control
--
-- agents.created_by — tracks who created each agent (for auto write-grant)
-- agent_access — explicit write grants from admin to editor/viewer users
--
-- Access rules:
--   admin/superadmin  → full write on all agents
--   editor            → read all agents; write own created + explicitly granted
--   viewer            → read all agents; no write
-- =============================================================================

ALTER TABLE agents ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';

CREATE TABLE IF NOT EXISTS agent_access (
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  PRIMARY KEY (agent_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_access_user ON agent_access(user_id);
