/**
 * @fileoverview Vercel AI SDK data-stream handler for the SIA hackathon frontend.
 *
 * Accepts POST /web-chat with { agentId, sessionId, message } and streams
 * the agent's response in Vercel AI SDK data-stream format so useChat() can
 * consume it directly. Tool calls from search_hotels / search_attractions /
 * search_insurance are forwarded as real 9:/a: events so the right panel
 * renders cards without any code-block parsing.
 *
 * Reuses getOrCreateTeamSession (which wires the agent's real MCP servers)
 * and calls ClaudeHandler.streamQuery() directly — bypasses MessageHandler
 * since we don't need Slack posting, file uploads, or thread-context building.
 *
 * @module runner/web-handler-server
 */
import type { ServerResponse } from 'http';
import type { AgentRunner } from './agent-runner';
import { logger } from './logger';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function handleWebChatStream(
  body: string,
  res: ServerResponse,
  runner: AgentRunner,
): Promise<void> {
  let parsed: { agentId?: string; sessionId?: string; message?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ error: 'invalid JSON body' }));
    return;
  }

  const { agentId, sessionId, message } = parsed;
  if (!agentId || !sessionId || !message?.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ error: 'agentId, sessionId, message required' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...CORS_HEADERS,
  });

  let session;
  try {
    session = await runner.getOrCreateTeamSession(agentId, sessionId);
  } catch (err) {
    res.write(`3:${JSON.stringify((err as Error).message)}\n`);
    res.end();
    return;
  }

  // Root participant: has the real ClaudeHandler with Pelago MCP wired up.
  const participant = session.participants.get(agentId);
  if (!participant) {
    res.write(`3:${JSON.stringify('participant not found for agentId: ' + agentId)}\n`);
    res.end();
    return;
  }

  // Stable session key per KrisFlyer member — maintains multi-turn context
  // across browser turns via the Claude Code SDK session resume mechanism.
  const sessionKey = `web:${sessionId}`;

  try {
    for await (const msg of participant.claudeHandler.streamQuery(message.trim(), sessionKey)) {
      if (msg.type === 'assistant') {
        const content: any[] = (msg as any).message?.content ?? [];
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            res.write(`0:${JSON.stringify(block.text)}\n`);
          } else if (block.type === 'tool_use') {
            res.write(`9:${JSON.stringify({
              toolCallId: block.id,
              toolName: block.name,
              args: block.input ?? {},
            })}\n`);
          }
        }
      } else if (msg.type === 'user') {
        const content: any[] = (msg as any).message?.content ?? [];
        for (const part of content) {
          if (part.type === 'tool_result') {
            let result: unknown = part.content;
            if (typeof part.content === 'string') {
              try { result = JSON.parse(part.content); } catch { /* keep string */ }
            } else if (Array.isArray(part.content)) {
              const joined = part.content
                .filter((p: any) => p.type === 'text')
                .map((p: any) => p.text)
                .join('');
              try { result = JSON.parse(joined); } catch { result = joined; }
            }
            // FastMCP wraps list returns as {result: [...]} — unwrap to the bare array/value
            if (result && typeof result === 'object' && !Array.isArray(result) && 'result' in (result as object)) {
              result = (result as any).result;
            }
            res.write(`a:${JSON.stringify({
              toolCallId: part.tool_use_id,
              result,
            })}\n`);
          }
        }
      }
    }

    res.write(`e:${JSON.stringify({ finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 }, isContinued: false })}\n`);
    res.write(`d:${JSON.stringify({ finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } })}\n`);
  } catch (err) {
    logger.error('web-chat stream error', {
      agentId,
      sessionId,
      error: (err as Error).message,
    });
    res.write(`3:${JSON.stringify((err as Error).message)}\n`);
  } finally {
    res.end();
  }
}
