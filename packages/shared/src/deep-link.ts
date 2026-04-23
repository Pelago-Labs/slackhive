/**
 * @fileoverview Platform-aware deep-link builder for task threads.
 *
 * Each `Task` holds `{platform, channel_id, thread_ts}` — the columns are
 * reused across platforms but the URL shape isn't. This module centralizes the
 * mapping so the UI can render "Open in Slack" / "Open in Telegram" / etc.
 * from a single helper.
 *
 * @module @slackhive/shared/deep-link
 */

import type { Task } from './types';

/**
 * Build a clickable URL to the original conversation, or `null` when the
 * platform has no stable public deep-link.
 *
 * Slack: uses the `app_redirect` URL, which opens the message inside the
 *        user's workspace without requiring us to store the workspace domain.
 * Telegram: channel deep-link `https://t.me/c/<chat>/<message_id>`.
 * Other platforms: no public deep-link yet — callers show a copy-to-clipboard
 *                  reference instead.
 */
export function deepLinkForTask(task: Pick<Task, 'platform' | 'channelId' | 'threadTs'>): string | null {
  switch (task.platform) {
    case 'slack':
      return `https://slack.com/app_redirect?channel=${encodeURIComponent(task.channelId)}&message_ts=${encodeURIComponent(task.threadTs)}`;
    case 'telegram':
      return `https://t.me/c/${encodeURIComponent(task.channelId)}/${encodeURIComponent(task.threadTs)}`;
    case 'discord':
    case 'whatsapp':
    case 'teams':
      return null;
    default:
      return null;
  }
}

/** Human-readable label for the deep-link button — e.g. "Open in Slack". */
export function deepLinkLabelForPlatform(platform: Task['platform']): string {
  switch (platform) {
    case 'slack':    return 'Open in Slack';
    case 'discord':  return 'Open in Discord';
    case 'telegram': return 'Open in Telegram';
    case 'whatsapp': return 'Open in WhatsApp';
    case 'teams':    return 'Open in Teams';
    default:         return 'Open conversation';
  }
}
