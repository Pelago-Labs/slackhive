/**
 * @fileoverview GET /api/auth/slack/status
 * Returns whether Slack OAuth is configured (client ID set).
 * Used by the login page to show/hide the "Sign in with Slack" button.
 *
 * @module web/api/auth/slack/status
 */

import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const clientId = await getSetting('slack_client_id');
  return NextResponse.json({ enabled: !!clientId });
}
