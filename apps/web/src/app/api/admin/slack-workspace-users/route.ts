import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { apiError } from '@/lib/api-error';
import { getSetting, upsertSlackUser } from '@/lib/db';
import { getDb } from '@slackhive/shared';

export const dynamic = 'force-dynamic';

async function fetchSlackUsers(token: string): Promise<Array<{ id: string; name: string; email: string }>> {
  const members: Array<{ id: string; name: string; email: string }> = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ limit: '200', ...(cursor ? { cursor } : {}) });
    const res = await fetch(`https://slack.com/api/users.list?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error ?? 'users.list failed');

    for (const m of data.members ?? []) {
      if (m.is_bot || m.deleted || m.id === 'USLACKBOT' || !m.profile?.email) continue;
      members.push({ id: m.id, name: m.real_name || m.name, email: m.profile.email });
    }

    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return members;
}

/** GET — list Slack workspace users not yet in SlackHive */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    requireRole(req as unknown as Request, 'admin');

    const token = await getSetting('slack_import_bot_token');
    if (!token) return NextResponse.json({ error: 'No import bot token configured. Add one in Settings → Users.' }, { status: 400 });

    const slackUsers = await fetchSlackUsers(token);

    const d = await getDb();
    const existing = await d.query('SELECT slack_email FROM users WHERE slack_email IS NOT NULL');
    const existingEmails = new Set(existing.rows.map(r => r.slack_email as string));

    return NextResponse.json({
      notOnboarded: slackUsers.filter(u => !existingEmails.has(u.email)),
      alreadyOnboarded: slackUsers.filter(u => existingEmails.has(u.email)),
    });
  } catch (err) {
    return apiError('admin/slack-workspace-users GET', err);
  }
}

/** POST — onboard selected Slack users as viewers */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    requireRole(req as unknown as Request, 'admin');

    const body = await req.json() as { users: Array<{ id: string; email: string; name: string }> };
    if (!Array.isArray(body.users) || !body.users.length) {
      return NextResponse.json({ error: 'No users provided' }, { status: 400 });
    }

    await Promise.all(body.users.map(u => upsertSlackUser(u.id, u.email, u.name)));

    return NextResponse.json({ onboarded: body.users.length });
  } catch (err) {
    return apiError('admin/slack-workspace-users POST', err);
  }
}
