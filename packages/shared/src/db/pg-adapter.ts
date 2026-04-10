/**
 * @fileoverview PostgreSQL adapter implementation.
 *
 * Wraps the `pg` Pool to conform to the DbAdapter interface.
 * This is a thin pass-through — pg already uses $1, $2, ... params.
 *
 * @module @slackhive/shared/db/pg-adapter
 */

import { Pool, PoolClient } from 'pg';
import type { DbAdapter, DbResult } from './adapter';

class PgAdapter implements DbAdapter {
  readonly type = 'postgres' as const;

  constructor(private pool: Pool) {}

  async query(sql: string, params?: unknown[]): Promise<DbResult> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }

  async transaction<T>(fn: (client: DbAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter = new PgClientAdapter(client);
      const result = await fn(txAdapter);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Wraps a single PoolClient for use inside a transaction. */
class PgClientAdapter implements DbAdapter {
  readonly type = 'postgres' as const;

  constructor(private client: PoolClient) {}

  async query(sql: string, params?: unknown[]): Promise<DbResult> {
    const result = await this.client.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }

  async transaction<T>(fn: (client: DbAdapter) => Promise<T>): Promise<T> {
    // Nested transactions: use SAVEPOINTs
    await this.client.query('SAVEPOINT nested_tx');
    try {
      const result = await fn(this);
      await this.client.query('RELEASE SAVEPOINT nested_tx');
      return result;
    } catch (err) {
      await this.client.query('ROLLBACK TO SAVEPOINT nested_tx');
      throw err;
    }
  }

  async close(): Promise<void> {
    // No-op for client adapter — pool manages lifecycle
  }
}

/**
 * Creates a PostgreSQL database adapter.
 *
 * @param databaseUrl - PostgreSQL connection string. Uses DATABASE_URL env if not provided.
 * @returns The initialized adapter.
 */
export async function createPgAdapter(databaseUrl?: string): Promise<DbAdapter> {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for PostgreSQL adapter');
  }

  const pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Verify connectivity
  const client = await pool.connect();
  client.release();

  return new PgAdapter(pool);
}
