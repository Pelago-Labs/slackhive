/**
 * @fileoverview Unit tests for SlackAdapter.resolveSlackMessageLinks.
 *
 * Tests cover:
 * - Single Slack archive link is resolved with message content
 * - Multiple links in one message are all resolved
 * - Links wrapped in Slack angle-bracket syntax (<url|label>)
 * - Invalid/missing messages are handled gracefully (no crash, text unchanged)
 * - Messages with no Slack links are passed through unchanged
 * - Max resolve limit is respected (MAX_LINK_RESOLVES = 5)
 * - API errors are caught and logged without breaking the message
 *
 * SlackAdapter is instantiated minimally — the Bolt App is not started.
 * resolveSlackMessageLinks is called directly via (adapter as any) since
 * the method needs `this.app.client` which we mock.
 *
 * @module runner/__tests__/slack-link-resolve.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlackAdapter } from '../adapters/slack-adapter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAdapter(): SlackAdapter {
  const adapter = new SlackAdapter(
    { platform: 'slack', botToken: 'xoxb-test', appToken: 'xapp-test', signingSecret: 'secret' },
    'test-agent',
  );
  return adapter;
}

function mockApp(adapter: SlackAdapter, historyFn: (...args: any[]) => any, usersInfoFn?: (...args: any[]) => any) {
  (adapter as any).app = {
    client: {
      conversations: { history: historyFn },
      users: {
        info: usersInfoFn ?? vi.fn().mockResolvedValue({
          user: { display_name: 'Test User', real_name: 'Test User' },
        }),
      },
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SlackAdapter.resolveSlackMessageLinks', () => {
  let adapter: SlackAdapter;

  beforeEach(() => {
    adapter = makeAdapter();
  });

  it('passes through text with no Slack links', async () => {
    mockApp(adapter, vi.fn());
    const text = 'hey can you check this booking?';
    const result = await adapter.resolveSlackMessageLinks(text);
    expect(result).toBe(text);
  });

  it('resolves a single bare Slack archive link', async () => {
    const historyFn = vi.fn().mockResolvedValue({
      messages: [{ ts: '1777315257.693249', user: 'U123', text: 'Voucher not received for order #456' }],
    });
    mockApp(adapter, historyFn);

    const text = 'Can you check this? https://v287.slack.com/archives/C04RC7S3B34/p1777315257693249';
    const result = await adapter.resolveSlackMessageLinks(text);

    expect(historyFn).toHaveBeenCalledWith({
      channel: 'C04RC7S3B34',
      latest: '1777315257.693249',
      inclusive: true,
      limit: 1,
    });
    expect(result).toContain('Voucher not received for order #456');
    expect(result).toContain('[Linked message from');
  });

  it('resolves Slack links wrapped in angle brackets with label', async () => {
    const historyFn = vi.fn().mockResolvedValue({
      messages: [{ ts: '1777315257.693249', user: 'U123', text: 'Payment failed' }],
    });
    mockApp(adapter, historyFn);

    const text = 'See <https://v287.slack.com/archives/C04RC7S3B34/p1777315257693249|this message>';
    const result = await adapter.resolveSlackMessageLinks(text);

    expect(historyFn).toHaveBeenCalled();
    expect(result).toContain('Payment failed');
  });

  it('resolves multiple links in one message', async () => {
    const historyFn = vi.fn()
      .mockResolvedValueOnce({
        messages: [{ ts: '1777315257.693249', user: 'U123', text: 'First message' }],
      })
      .mockResolvedValueOnce({
        messages: [{ ts: '1777315258.000000', user: 'U456', text: 'Second message' }],
      });
    mockApp(adapter, historyFn);

    const text = [
      'Check both:',
      'https://v287.slack.com/archives/C04RC7S3B34/p1777315257693249',
      'https://v287.slack.com/archives/C05AB1234/p1777315258000000',
    ].join('\n');
    const result = await adapter.resolveSlackMessageLinks(text);

    expect(historyFn).toHaveBeenCalledTimes(2);
    expect(result).toContain('First message');
    expect(result).toContain('Second message');
  });

  it('handles API errors gracefully without crashing', async () => {
    const historyFn = vi.fn().mockRejectedValue(new Error('channel_not_found'));
    mockApp(adapter, historyFn);

    const text = 'Check https://v287.slack.com/archives/C04RC7S3B34/p1777315257693249';
    const result = await adapter.resolveSlackMessageLinks(text);

    // Original text preserved, no resolved content appended
    expect(result).toBe(text);
  });

  it('handles missing message (ts mismatch) gracefully', async () => {
    const historyFn = vi.fn().mockResolvedValue({
      messages: [{ ts: '9999999999.999999', user: 'U123', text: 'Wrong message' }],
    });
    mockApp(adapter, historyFn);

    const text = 'Check https://v287.slack.com/archives/C04RC7S3B34/p1777315257693249';
    const result = await adapter.resolveSlackMessageLinks(text);

    // No resolved content because ts didn't match
    expect(result).toBe(text);
  });

  it('handles empty messages array from API', async () => {
    const historyFn = vi.fn().mockResolvedValue({ messages: [] });
    mockApp(adapter, historyFn);

    const text = 'Check https://v287.slack.com/archives/C04RC7S3B34/p1777315257693249';
    const result = await adapter.resolveSlackMessageLinks(text);
    expect(result).toBe(text);
  });

  it('respects MAX_LINK_RESOLVES limit', async () => {
    const historyFn = vi.fn().mockResolvedValue({
      messages: [{ ts: '1000000000.000001', user: 'U123', text: 'msg' }],
    });
    mockApp(adapter, historyFn);

    // 7 links but only first 5 should be resolved
    const links = Array.from({ length: 7 }, (_, i) =>
      `https://v287.slack.com/archives/C04RC7S3B34/p1000000000000001`
    ).join('\n');
    await adapter.resolveSlackMessageLinks(links);

    expect(historyFn).toHaveBeenCalledTimes(5);
  });

  it('resolves links with query parameters (thread links)', async () => {
    const historyFn = vi.fn().mockResolvedValue({
      messages: [{ ts: '1777315257.693249', user: 'U123', text: 'Thread reply content' }],
    });
    mockApp(adapter, historyFn);

    const text = 'Check <https://v287.slack.com/archives/C04RC7S3B34/p1777315257693249?thread_ts=1777315200.000000&cid=C04RC7S3B34>';
    const result = await adapter.resolveSlackMessageLinks(text);

    expect(historyFn).toHaveBeenCalledWith({
      channel: 'C04RC7S3B34',
      latest: '1777315257.693249',
      inclusive: true,
      limit: 1,
    });
    expect(result).toContain('Thread reply content');
  });

  it('includes channel reference in resolved output', async () => {
    const historyFn = vi.fn().mockResolvedValue({
      messages: [{ ts: '1777315257.693249', user: 'U123', text: 'Important update' }],
    });
    mockApp(adapter, historyFn);

    const text = 'https://v287.slack.com/archives/C04RC7S3B34/p1777315257693249';
    const result = await adapter.resolveSlackMessageLinks(text);

    expect(result).toContain('<#C04RC7S3B34>');
  });
});
