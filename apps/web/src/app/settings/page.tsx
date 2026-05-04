'use client';

/**
 * @fileoverview Platform settings page — branding, dashboard, and user management.
 *
 * Tabs: General · Users (admin only)
 *
 * @module web/app/settings
 */

import React, { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { MODELS, DEFAULT_COACH_MODEL, COACH_MODEL_SETTING_KEY } from '@slackhive/shared';
import { Portal } from '@/lib/portal';
import { useAuth } from '@/lib/auth-context';

type Tab = 'general' | 'users' | 'auth';

interface User {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

interface AgentBasic {
  id: string;
  name: string;
  slug: string;
}

const DEFAULTS: Record<string, string> = {
  appName: 'SlackHive',
  tagline: 'AI agent teams on Slack',
  logoUrl: '',
  dashboardTitle: 'Welcome to SlackHive',
  [COACH_MODEL_SETTING_KEY]: DEFAULT_COACH_MODEL,
};

/**
 * Settings page with General and Users tabs.
 *
 * @returns {JSX.Element}
 */
export default function SettingsPage() {
  const { canEdit, canManageUsers, role } = useAuth();
  const isSuperadmin = role === 'superadmin';
  const [tab, setTab] = useState<Tab>('general');

  return (
    <div className="fade-up" style={{ padding: '36px 40px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em', margin: 0 }}>
          Settings
        </h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          Configure platform branding, appearance, and access.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        <TabBtn active={tab === 'general'} onClick={() => setTab('general')}>General</TabBtn>
        {canManageUsers && <TabBtn active={tab === 'users'} onClick={() => setTab('users')}>Users</TabBtn>}
        {isSuperadmin && <TabBtn active={tab === 'auth'} onClick={() => setTab('auth')}>Authentication</TabBtn>}
      </div>

      {tab === 'general' && <GeneralTab />}
      {tab === 'users' && canManageUsers && <UsersTab />}
      {tab === 'auth' && isSuperadmin && <AuthTab />}
    </div>
  );
}

// =============================================================================
// General tab
// =============================================================================

function GeneralTab() {
  const [appName, setAppName] = useState(DEFAULTS.appName);
  const [tagline, setTagline] = useState(DEFAULTS.tagline);
  const [logoUrl, setLogoUrl] = useState(DEFAULTS.logoUrl);
  const [dashboardTitle, setDashboardTitle] = useState(DEFAULTS.dashboardTitle);
  const [coachModel, setCoachModel] = useState(DEFAULTS[COACH_MODEL_SETTING_KEY]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((s: Record<string, string>) => {
        if (s.appName) setAppName(s.appName);
        if (s.tagline) setTagline(s.tagline);
        if (s.logoUrl !== undefined && s.logoUrl !== '') setLogoUrl(s.logoUrl);
        if (s.dashboardTitle) setDashboardTitle(s.dashboardTitle);
        if (s[COACH_MODEL_SETTING_KEY]) setCoachModel(s[COACH_MODEL_SETTING_KEY]);
      })
      .catch(() => {});
  }, []);

  async function save(key: string, value: string) {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      setToast(`Saved`);
      setTimeout(() => setToast(''), 2000);
    } finally { setSaving(false); }
  }

  async function saveAll() {
    setSaving(true);
    try {
      await Promise.all([
        fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'appName', value: appName }) }),
        fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'tagline', value: tagline }) }),
        fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'logoUrl', value: logoUrl }) }),
        fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'dashboardTitle', value: dashboardTitle }) }),
        fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: COACH_MODEL_SETTING_KEY, value: coachModel }) }),
      ]);
      setToast('All settings saved');
      setTimeout(() => setToast(''), 2000);
    } finally { setSaving(false); }
  }

  return (
    <>
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 999,
          background: 'var(--accent)', color: 'var(--accent-fg)',
          padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          boxShadow: 'var(--shadow-md)',
        }}>{toast}</div>
      )}

      <Section title="Branding">
        <Field label="App Name" hint="Displayed in the sidebar header and browser tab." maxLength={30}
          value={appName} onChange={setAppName} onBlur={() => save('appName', appName)} />
        <Field label="Tagline" hint="Short description shown below the app name." maxLength={60}
          value={tagline} onChange={setTagline} onBlur={() => save('tagline', tagline)} />
        <Field label="Logo URL" hint="URL to a square image (28×28). Leave empty for the default icon." maxLength={500}
          value={logoUrl} onChange={setLogoUrl} onBlur={() => save('logoUrl', logoUrl)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>Preview:</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl || '/logo.svg'} alt="Logo" style={{ width: 28, height: 28, borderRadius: 8, objectFit: 'cover' }} />
          {!logoUrl && <span style={{ fontSize: 11, color: 'var(--subtle)', fontStyle: 'italic' }}>Using default logo</span>}
        </div>
      </Section>

      <Section title="Dashboard">
        <Field label="Dashboard Title" hint="Main heading on the dashboard page." maxLength={80}
          value={dashboardTitle} onChange={setDashboardTitle} onBlur={() => save('dashboardTitle', dashboardTitle)} />
      </Section>

      <Section title="AI">
        <SelectField
          label="Coach Model"
          value={coachModel}
          options={MODELS}
          onChange={v => { setCoachModel(v); save(COACH_MODEL_SETTING_KEY, v); }}
          hint="Model used by Coach to generate prompts and skills. Not the model your agents run on."
        />
      </Section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <PrimaryBtn onClick={saveAll} loading={saving}>Save All</PrimaryBtn>
      </div>
    </>
  );
}

// =============================================================================
// Users tab
// =============================================================================

function UsersTab() {
  const { role: currentRole } = useAuth();
  const isSuperadmin = currentRole === 'superadmin';
  const [users, setUsers] = useState<User[]>([]);
  const [agents, setAgents] = useState<AgentBasic[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'viewer' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  // Map of userId → map of agentId → 'none' | 'trigger' | 'view' | 'edit'
  const [accessGrants, setAccessGrants] = useState<Record<string, Record<string, 'none' | 'trigger' | 'view' | 'edit'>>>({});
  // Map of userId → set of agentIds where user is the creator (owner)
  const [ownerAgents, setOwnerAgents] = useState<Record<string, Set<string>>>({});
  const [loadingGrants, setLoadingGrants] = useState<string | null>(null);
  // Password reset modal state
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  // Slack import
  const [importToken, setImportToken] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [slackMembers, setSlackMembers] = useState<Array<{ id: string; name: string; email: string; onboarded: boolean }>>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [askToken, setAskToken] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/auth/users').then(r => r.json()),
      fetch('/api/agents').then(r => r.json()),
    ]).then(([u, a]) => { setUsers(u); setAgents(a); }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then((s: Record<string, string>) => {
      if (s.slack_import_bot_token) setImportToken(s.slack_import_bot_token);
    }).catch(() => {});
  }, []);

  const doFetchMembers = async () => {
    setImportError('');
    setAskToken(false);
    setImportLoading(true);
    setImportModal(true);
    try {
      const r = await fetch('/api/admin/slack-workspace-users');
      const data = await r.json();
      if (!r.ok) { setImportError(data.error || 'Failed to fetch Slack users'); setSlackMembers([]); return; }
      const members = data.members ?? [];
      setSlackMembers(members);
      setSelected(new Set(members.filter((m: { onboarded: boolean; id: string }) => !m.onboarded).map((m: { id: string }) => m.id)));
    } catch { setImportError('Network error'); } finally { setImportLoading(false); }
  };

  const openImport = async () => {
    if (importToken) {
      await doFetchMembers();
    } else {
      setTokenInput('');
      setImportError('');
      setAskToken(true);
      setImportModal(true);
    }
  };

  const submitToken = async () => {
    if (!tokenInput.trim()) return;
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'slack_import_bot_token', value: tokenInput.trim() }) });
    setImportToken(tokenInput.trim());
    await doFetchMembers();
  };

  const onboardSelected = async () => {
    const toOnboard = slackMembers.filter(m => selected.has(m.id));
    if (!toOnboard.length) return;
    setOnboarding(true);
    try {
      await fetch('/api/admin/slack-workspace-users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ users: toOnboard }) });
      setSlackMembers(prev => prev.map(m => selected.has(m.id) ? { ...m, onboarded: true } : m));
      setSelected(new Set());
      load();
    } finally { setOnboarding(false); }
  };

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const [importSearch, setImportSearch] = useState('');
  const filteredMembers = slackMembers.filter(m =>
    !importSearch || m.name.toLowerCase().includes(importSearch.toLowerCase()) || m.email.toLowerCase().includes(importSearch.toLowerCase())
  );
  const notOnboarded = slackMembers.filter(m => !m.onboarded);
  const allSelected = notOnboarded.length > 0 && notOnboarded.every(m => selected.has(m.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(notOnboarded.map(m => m.id)));

  const create = async () => {
    if (!newUser.username || !newUser.password) { setError('Username and password required'); return; }
    setSaving(true); setError('');
    try {
      const r = await fetch('/api/auth/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || 'Failed'); return; }
      setShowForm(false);
      setNewUser({ username: '', password: '', role: 'viewer' });
      load();
    } finally { setSaving(false); }
  };

  const remove = async (id: string, username: string) => {
    if (!confirm(`Delete user "${username}"?`)) return;
    await fetch(`/api/auth/users/${id}`, { method: 'DELETE' });
    load();
  };

  const changeRole = async (id: string, role: string) => {
    setUpdatingRole(id);
    await fetch(`/api/auth/users/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    setUpdatingRole(null);
    load();
  };

  const openReset = (u: User) => {
    setResetUser(u);
    setResetPwd('');
    setResetError('');
    setResetSuccess(false);
  };

  const closeReset = () => {
    if (resetting) return;
    setResetUser(null);
    setResetPwd('');
    setResetError('');
    setResetSuccess(false);
  };

  const submitReset = async () => {
    if (!resetUser) return;
    if (resetPwd.length < 8) { setResetError('Password must be at least 8 characters'); return; }
    setResetting(true); setResetError('');
    try {
      const r = await fetch(`/api/auth/users/${resetUser.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPwd }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setResetError(data.error || 'Failed to reset password');
        return;
      }
      setResetSuccess(true);
      setTimeout(() => { setResetUser(null); setResetPwd(''); setResetSuccess(false); }, 1200);
    } finally { setResetting(false); }
  };

  const toggleExpand = async (userId: string) => {
    if (expandedUser === userId) { setExpandedUser(null); return; }
    setExpandedUser(userId);
    if (accessGrants[userId]) return; // already loaded
    setLoadingGrants(userId);
    // Load all access grants for this user across all agents
    const grants: Record<string, 'none' | 'trigger' | 'view' | 'edit'> = {};
    const owners = new Set<string>();
    await Promise.all(agents.map(async (a) => {
      const r = await fetch(`/api/agents/${a.id}/access`);
      const data = await r.json();
      const match = data.writeUsers?.find((w: { userId: string; accessLevel?: string; canWrite?: boolean; isOwner: boolean }) => w.userId === userId);
      if (match) {
        const lvl = (match.accessLevel as 'trigger' | 'view' | 'edit' | undefined) ?? (match.canWrite ? 'edit' : 'view');
        grants[a.id] = lvl;
        if (match.isOwner) owners.add(a.id);
      }
    }));
    setAccessGrants(prev => ({ ...prev, [userId]: grants }));
    setOwnerAgents(prev => ({ ...prev, [userId]: owners }));
    setLoadingGrants(null);
  };

  const setAccess = async (userId: string, agentId: string, level: 'none' | 'trigger' | 'view' | 'edit') => {
    if (level === 'none') {
      await fetch(`/api/agents/${agentId}/access`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
    } else {
      await fetch(`/api/agents/${agentId}/access`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, accessLevel: level }),
      });
    }
    setAccessGrants(prev => ({
      ...prev,
      [userId]: { ...prev[userId], [agentId]: level },
    }));
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          Manage platform access. Superadmin is configured via environment variables.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={openImport} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--surface-2)', color: 'var(--text)',
            padding: '8px 14px', borderRadius: 8,
            fontSize: 13, fontWeight: 500, border: '1px solid var(--border)', cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}>
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 0v0M5 10h10M10 5l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Import from Slack
          </button>
          <button onClick={() => setShowForm(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--accent)', color: 'var(--accent-fg)',
            padding: '8px 16px', borderRadius: 8,
            fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            Add User
          </button>
        </div>
      </div>

      {/* User list */}
      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading...</p>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {/* Superadmin row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            borderBottom: users.length > 0 ? '1px solid var(--border)' : 'none',
            background: 'var(--surface-2)',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 600, color: 'var(--accent-fg)',
            }}>S</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>admin</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Environment variable</div>
            </div>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
              color: '#d97706', background: 'rgba(217,119,6,0.1)',
              padding: '2px 8px', borderRadius: 4,
            }}>superadmin</span>
          </div>

          {users.map((u, i) => (
            <div key={u.id} style={{ borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none' }}>
              {/* User row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: u.role === 'admin' ? '#171717' : u.role === 'editor' ? '#059669' : 'var(--surface-2)',
                  border: u.role === 'admin' ? 'none' : '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 600, color: u.role === 'admin' ? '#fff' : 'var(--text)',
                }}>{u.username.charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{u.username}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Created {new Date(u.createdAt).toLocaleDateString()}</div>
                </div>
                <select
                  value={u.role}
                  disabled={updatingRole === u.id}
                  onChange={e => changeRole(u.id, e.target.value)}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 5,
                    border: '1px solid var(--border)', cursor: 'pointer',
                    background: u.role === 'admin' ? 'rgba(37,99,235,0.1)' : u.role === 'editor' ? 'rgba(5,150,105,0.1)' : 'var(--surface-2)',
                    color: u.role === 'admin' ? '#2563eb' : u.role === 'editor' ? '#059669' : 'var(--muted)',
                    fontFamily: 'var(--font-sans)', outline: 'none',
                    opacity: updatingRole === u.id ? 0.5 : 1,
                  }}
                >
                  <option value="admin">admin</option>
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </select>
                {/* Agent access — editors and viewers can be granted per-agent access */}
                {(u.role === 'editor' || u.role === 'viewer') && (
                  <button
                    onClick={() => toggleExpand(u.id)}
                    style={{
                      background: expandedUser === u.id ? 'rgba(59,130,246,0.1)' : 'var(--surface-2)',
                      border: '1px solid var(--border)', borderRadius: 6,
                      color: expandedUser === u.id ? 'var(--accent)' : 'var(--muted)',
                      fontSize: 11, fontWeight: 500, cursor: 'pointer', padding: '3px 10px',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >Agent Access</button>
                )}
                {isSuperadmin && (
                  <button
                    onClick={() => openReset(u)}
                    title="Reset password"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 26, padding: 0,
                      background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6,
                      color: 'var(--muted)', cursor: 'pointer', opacity: 0.7,
                      transition: 'opacity 0.12s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
                  ><KeyRound size={13} /></button>
                )}
                <button onClick={() => remove(u.id, u.username)} style={{
                  background: 'none', border: 'none', color: '#dc2626',
                  fontSize: 12, cursor: 'pointer', opacity: 0.6,
                  fontFamily: 'var(--font-sans)', transition: 'opacity 0.12s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
                >Delete</button>
              </div>

              {/* Expanded agent access panel */}
              {expandedUser === u.id && (
                <div style={{
                  margin: '0 16px 12px', padding: '14px 16px', borderRadius: 8,
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                }}>
                  <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
                    Agent access
                    <span style={{ fontWeight: 400, color: 'var(--subtle)', marginLeft: 6 }}>
                      {u.role === 'editor' ? '— editors also always access their own agents' : '— viewers see only what is granted'}
                    </span>
                  </p>
                  <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--subtle)' }}>
                    <strong style={{ color: 'var(--muted)' }}>No access</strong> — hidden everywhere &nbsp;·&nbsp;
                    <strong style={{ color: '#d97706' }}>Trigger</strong> — Slack only, not in SlackHive &nbsp;·&nbsp;
                    <strong style={{ color: '#059669' }}>View</strong> — SlackHive + Slack &nbsp;·&nbsp;
                    <strong style={{ color: '#3b82f6' }}>Edit</strong> — full access
                  </p>
                  {loadingGrants === u.id ? (
                    <p style={{ fontSize: 12, color: 'var(--subtle)', margin: 0 }}>Loading…</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {agents.map(a => {
                        const isOwner = ownerAgents[u.id]?.has(a.id) ?? false;
                        const level = accessGrants[u.id]?.[a.id] ?? 'none';
                        const levels: ('none' | 'trigger' | 'view' | 'edit')[] = u.role === 'viewer' ? ['none', 'trigger', 'view'] : ['none', 'trigger', 'view', 'edit'];
                        return (
                          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{a.name}</span>
                            {isOwner ? (
                              <span style={{
                                fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 5,
                                border: '1px solid rgba(245,158,11,0.4)', color: '#d97706',
                                background: 'rgba(245,158,11,0.1)',
                              }}>Owner</span>
                            ) : (
                            <div style={{ display: 'flex', gap: 4 }}>
                              {levels.map(lvl => (
                                <button
                                  key={lvl}
                                  onClick={() => setAccess(u.id, a.id, lvl)}
                                  style={{
                                    fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 5,
                                    border: '1px solid var(--border)', cursor: 'pointer',
                                    fontFamily: 'var(--font-sans)',
                                    background: level === lvl
                                      ? lvl === 'edit' ? 'rgba(59,130,246,0.15)' : lvl === 'view' ? 'rgba(5,150,105,0.12)' : lvl === 'trigger' ? 'rgba(217,119,6,0.1)' : 'var(--surface)'
                                      : 'var(--surface)',
                                    color: level === lvl
                                      ? lvl === 'edit' ? '#3b82f6' : lvl === 'view' ? '#059669' : lvl === 'trigger' ? '#d97706' : 'var(--muted)'
                                      : 'var(--subtle)',
                                    borderColor: level === lvl
                                      ? lvl === 'edit' ? 'rgba(59,130,246,0.4)' : lvl === 'view' ? 'rgba(5,150,105,0.4)' : lvl === 'trigger' ? 'rgba(217,119,6,0.4)' : 'var(--border)'
                                      : 'var(--border)',
                                  }}
                                  title={lvl === 'none' ? 'Cannot see agent in SlackHive or interact in Slack' : lvl === 'trigger' ? 'Can message the agent in Slack only — not visible in SlackHive' : lvl === 'view' ? 'Can see conversations in SlackHive and message in Slack' : 'Full access — edit agent settings, view conversations, and message in Slack'}
                                >{lvl === 'none' ? 'No access' : lvl === 'trigger' ? 'Trigger' : lvl === 'view' ? 'View' : 'Edit'}</button>
                              ))}
                            </div>
                            )}
                          </div>
                        );
                      })}
                      {agents.length === 0 && <span style={{ fontSize: 12, color: 'var(--subtle)' }}>No agents yet</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {users.length === 0 && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              No additional users. Only the superadmin account exists.
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      {showForm && (
        <Portal>
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          backdropFilter: 'blur(2px)',
        }}>
          <div style={{
            background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)',
            padding: 28, width: 380, boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column', gap: 16,
            maxHeight: '90vh', overflow: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>New User</h3>
              <button onClick={() => { setShowForm(false); setError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>&times;</button>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>Username</label>
              <input type="text" value={newUser.username} onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-sans)' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>Password</label>
              <input type="password" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-sans)' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>Role</label>
              <select value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 13, outline: 'none', fontFamily: 'var(--font-sans)', background: 'var(--surface)' }}>
                <option value="viewer">Viewer — read-only access</option>
                <option value="editor">Editor — create/edit agents, jobs, settings</option>
                <option value="admin">Admin — full access including user management</option>
              </select>
            </div>
            {error && <div style={{ fontSize: 12, color: '#dc2626', background: 'rgba(220,38,38,0.06)', padding: '6px 10px', borderRadius: 6 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowForm(false); setError(''); }}
                style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>Cancel</button>
              <button onClick={create} disabled={saving}
                style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                {saving ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* Import from Slack modal */}
      {importModal && (
        <Portal>
        <div onClick={() => { if (!onboarding) setImportModal(false); }} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          backdropFilter: 'blur(2px)',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)',
            padding: 28, width: 460, boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column', gap: 16,
            maxHeight: '80vh',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Import from Slack</h3>
              <button onClick={() => setImportModal(false)} disabled={onboarding}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>&times;</button>
            </div>

            {askToken && (
              <>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                  Enter a Slack bot token with <code>users:read</code> and <code>users:read.email</code> scopes.<br />
                  Find it in your Slack app → <strong>OAuth &amp; Permissions → Bot User OAuth Token</strong>.
                </p>
                <input
                  autoFocus
                  type="password"
                  value={tokenInput}
                  onChange={e => setTokenInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitToken(); }}
                  placeholder="xoxb-..."
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-mono, monospace)', background: 'var(--surface)' }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setImportModal(false)}
                    style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>Cancel</button>
                  <button onClick={submitToken} disabled={!tokenInput.trim()} style={{
                    padding: '8px 18px', borderRadius: 7, border: 'none',
                    background: 'var(--accent)', color: 'var(--accent-fg)',
                    fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                    opacity: tokenInput.trim() ? 1 : 0.5,
                  }}>Continue</button>
                </div>
              </>
            )}

            {importLoading && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Fetching workspace members…</p>}
            {importError && <div style={{ fontSize: 12, color: '#dc2626', background: 'rgba(220,38,38,0.06)', padding: '8px 12px', borderRadius: 6 }}>{importError}</div>}

            {!askToken && !importLoading && !importError && (
              <>
                {slackMembers.length > 0 && (
                  <input
                    type="text"
                    placeholder="Search by name or email…"
                    value={importSearch}
                    onChange={e => setImportSearch(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-sans)', background: 'var(--surface)' }}
                  />
                )}
                {slackMembers.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, color: 'var(--muted)', userSelect: 'none' }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer' }} />
                      Select all not onboarded ({notOnboarded.length})
                    </label>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--subtle)' }}>{slackMembers.length} total · {slackMembers.filter(m => m.onboarded).length} onboarded</span>
                  </div>
                )}
                {slackMembers.length === 0 && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>No members found in workspace.</p>}
                {filteredMembers.length > 0 && (
                  <div style={{ overflowY: 'auto', maxHeight: 340, border: '1px solid var(--border)', borderRadius: 8 }}>
                    {filteredMembers.map((m, i) => (
                      <div key={m.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                        borderBottom: i < filteredMembers.length - 1 ? '1px solid var(--border)' : 'none',
                        background: m.onboarded ? 'var(--surface-2)' : 'var(--surface)',
                        opacity: m.onboarded ? 0.6 : 1,
                      }}>
                        <input
                          type="checkbox"
                          checked={selected.has(m.id)}
                          disabled={m.onboarded}
                          onChange={() => toggleSelect(m.id)}
                          style={{ cursor: m.onboarded ? 'default' : 'pointer', flexShrink: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                          {m.email && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{m.email}</div>}
                        </div>
                        {m.onboarded
                          ? <span style={{ fontSize: 10, fontWeight: 600, color: '#059669', background: 'rgba(5,150,105,0.1)', padding: '2px 8px', borderRadius: 4, flexShrink: 0 }}>Onboarded</span>
                          : null}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                  <button onClick={() => { setTokenInput(''); setAskToken(true); setSlackMembers([]); setImportError(''); }} style={{
                    background: 'none', border: 'none', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', marginRight: 'auto', fontFamily: 'var(--font-sans)', textDecoration: 'underline',
                  }}>Change token</button>
                  <button onClick={() => setImportModal(false)} disabled={onboarding}
                    style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>Close</button>
                  {selected.size > 0 && (
                    <button onClick={onboardSelected} disabled={onboarding} style={{
                      padding: '8px 18px', borderRadius: 7, border: 'none',
                      background: 'var(--accent)', color: 'var(--accent-fg)',
                      fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-sans)',
                      opacity: onboarding ? 0.6 : 1,
                    }}>
                      {onboarding ? 'Onboarding…' : `Onboard Selected (${selected.size})`}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        </Portal>
      )}

      {/* Reset password modal (superadmin only) */}
      {resetUser && (
        <Portal>
        <div
          onClick={closeReset}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)',
              padding: 28, width: 380, boxShadow: 'var(--shadow-lg)',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>Reset password</h3>
              <button onClick={closeReset} disabled={resetting}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>&times;</button>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
              Set a new password for <strong style={{ color: 'var(--text)' }}>{resetUser.username}</strong>. They&apos;ll need the new password on their next login.
            </p>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>New password</label>
              <input
                type="password"
                autoFocus
                value={resetPwd}
                disabled={resetting || resetSuccess}
                onChange={e => setResetPwd(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitReset(); }}
                placeholder="Minimum 8 characters"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-sans)' }}
              />
            </div>
            {resetError && <div style={{ fontSize: 12, color: '#dc2626', background: 'rgba(220,38,38,0.06)', padding: '6px 10px', borderRadius: 6 }}>{resetError}</div>}
            {resetSuccess && <div style={{ fontSize: 12, color: '#059669', background: 'rgba(5,150,105,0.08)', padding: '6px 10px', borderRadius: 6 }}>Password updated</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={closeReset} disabled={resetting}
                style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>Cancel</button>
              <button onClick={submitReset} disabled={resetting || resetSuccess || !resetPwd}
                style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font-sans)', opacity: (resetting || resetSuccess || !resetPwd) ? 0.6 : 1 }}>
                {resetting ? 'Saving…' : 'Reset password'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  );
}

// =============================================================================
// Authentication tab (superadmin only)
// =============================================================================

const SLACK_CLIENT_ID_KEY = 'slack_client_id';
const SLACK_CLIENT_SECRET_KEY = 'slack_client_secret';

function AuthTab() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  useEffect(() => { setRedirectUri(`${window.location.origin}/api/auth/slack/callback`); }, []);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((s: Record<string, string>) => {
        if (s[SLACK_CLIENT_ID_KEY]) setClientId(s[SLACK_CLIENT_ID_KEY]);
        if (s[SLACK_CLIENT_SECRET_KEY]) setClientSecret(s[SLACK_CLIENT_SECRET_KEY]);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      await Promise.all([
        fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: SLACK_CLIENT_ID_KEY, value: clientId }) }),
        fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: SLACK_CLIENT_SECRET_KEY, value: clientSecret }) }),
      ]);
      setToast('Saved');
      setTimeout(() => setToast(''), 2000);
    } finally { setSaving(false); }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--surface)',
    fontSize: 13, color: 'var(--text)', outline: 'none',
    fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 6,
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: '0 0 4px' }}>Sign in with Slack</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 24px' }}>
        Allow users to log in using their Slack account. Get these from{' '}
        <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>api.slack.com/apps</a>
        {' '}→ your app → Basic Information. Add user token scopes: <code>openid</code>, <code>profile</code>, <code>email</code>.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>Redirect URI <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(add this in Slack → OAuth & Permissions)</span></label>
          <input
            style={{ ...inputStyle, color: 'var(--muted)', cursor: 'text' }}
            value={redirectUri}
            readOnly
            onFocus={e => e.currentTarget.select()}
          />
        </div>
        <div>
          <label style={labelStyle}>Client ID</label>
          <input
            style={inputStyle}
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="123456789012.123456789012"
          />
        </div>
        <div>
          <label style={labelStyle}>Client Secret</label>
          <input
            style={inputStyle}
            type="password"
            value={clientSecret}
            onChange={e => setClientSecret(e.target.value)}
            placeholder="••••••••••••••••••••••••••••••••"
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={save}
            disabled={saving || !clientId || !clientSecret}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: 'var(--accent)', color: 'var(--accent-fg)',
              fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {toast && <span style={{ fontSize: 13, color: 'var(--success, #16a34a)' }}>{toast}</span>}
        </div>
        {clientId && (
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>
            ✓ Sign in with Slack is enabled. Users will see the button on the login page.
          </p>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Shared UI helpers
// =============================================================================

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '10px 16px', fontSize: 13,
      color: active ? 'var(--text)' : 'var(--muted)',
      fontWeight: active ? 600 : 400,
      fontFamily: 'var(--font-sans)',
      position: 'relative',
      transition: 'color 0.15s',
      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
      marginBottom: -1,
    }}>{children}</button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22, paddingBottom: 22, borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, onBlur, hint, maxLength }: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; hint?: string; maxLength?: number;
}) {
  const overLimit = maxLength !== undefined && value.length > maxLength;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>{label}</label>
        {maxLength !== undefined && (
          <span style={{ fontSize: 10, color: overLimit ? 'var(--red)' : 'var(--subtle)', fontFamily: 'var(--font-mono)' }}>
            {value.length}/{maxLength}
          </span>
        )}
      </div>
      <input type="text" value={value} maxLength={maxLength} onChange={e => onChange(e.target.value)}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; onBlur?.(); }}
        style={{
          width: '100%', background: 'var(--surface)',
          border: `1px solid ${overLimit ? 'var(--red)' : 'var(--border)'}`,
          borderRadius: 7, padding: '8px 11px', color: 'var(--text)',
          fontSize: 13, fontFamily: 'var(--font-sans)', outline: 'none',
          transition: 'border-color 0.15s', boxSizing: 'border-box',
        }}
        onFocus={e => { if (!overLimit) e.currentTarget.style.borderColor = 'var(--accent)'; }}
      />
      {hint && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--subtle)' }}>{hint}</p>}
    </div>
  );
}

function SelectField({ label, value, options, onChange, hint }: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; sub?: string }[];
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 5 }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 7, padding: '8px 11px', color: 'var(--text)',
          fontSize: 13, fontFamily: 'var(--font-sans)', outline: 'none',
          transition: 'border-color 0.15s', boxSizing: 'border-box',
          cursor: 'pointer',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}{o.sub ? ` — ${o.sub}` : ''}
          </option>
        ))}
      </select>
      {hint && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--subtle)' }}>{hint}</p>}
    </div>
  );
}

function PrimaryBtn({ children, onClick, loading }: { children: React.ReactNode; onClick?: () => void; loading?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} style={{
      background: loading ? 'var(--border)' : 'var(--accent)',
      color: 'var(--accent-fg)', border: 'none', borderRadius: 7,
      padding: '8px 18px', fontSize: 13, fontWeight: 500,
      cursor: loading ? 'not-allowed' : 'pointer',
      fontFamily: 'var(--font-sans)', transition: 'opacity 0.15s',
    }}
      onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
    >{loading ? 'Saving...' : children}</button>
  );
}
