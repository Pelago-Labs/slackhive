/**
 * @fileoverview Structured logger for the runner service.
 *
 * Wraps Winston to provide consistent JSON-structured logs with
 * support for an optional agent context field. All log entries
 * include a timestamp and log level.
 *
 * @module runner/logger
 */

import winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const { combine, timestamp, json, colorize, simple } = winston.format;

const isDev = process.env.NODE_ENV !== 'production';

// In native (non-Docker) mode, also write logs to a file for the web UI to stream.
const transports: winston.transport[] = [
  new winston.transports.Console(),
];

const isNativeMode = process.env.DATABASE_TYPE === 'sqlite' || !process.env.DATABASE_URL;
if (isNativeMode) {
  const logDir = process.env.LOG_DIR ?? path.join(
    process.env.HOME ?? process.env.USERPROFILE ?? '/tmp',
    '.slackhive', 'logs'
  );
  fs.mkdirSync(logDir, { recursive: true });
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'runner.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 3,
      format: combine(timestamp(), json()),
    })
  );
}

/**
 * The shared logger instance for the runner service.
 * In native mode, also writes JSON logs to ~/.slackhive/logs/runner.log
 * for the web UI to stream via SSE.
 */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  format: isDev
    ? combine(timestamp(), colorize(), simple())
    : combine(timestamp(), json()),
  transports,
});

/**
 * Creates a child logger with a fixed `agent` context field.
 * All log entries from the child will include `{ agent: slug }`.
 *
 * @param {string} slug - Agent slug to attach to all log entries.
 * @returns {winston.Logger} Child logger with agent context.
 *
 * @example
 * const log = agentLogger('gilfoyle');
 * log.info('Session started', { sessionKey: 'U123-C456-...' });
 * // → { level: 'info', message: 'Session started', agent: 'gilfoyle', sessionKey: '...' }
 */
export function agentLogger(slug: string): winston.Logger {
  return logger.child({ agent: slug });
}
