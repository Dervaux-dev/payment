import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { getConfig } from './config.js';

const schemaSql = `
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  id TEXT NOT NULL,
  short_id TEXT UNIQUE,
  description TEXT NOT NULL,
  amount_rwf BIGINT NOT NULL CHECK (amount_rwf > 0),
  fee_bps INTEGER NOT NULL CHECK (fee_bps >= 0 AND fee_bps < 10000),
  fee_rwf BIGINT NOT NULL CHECK (fee_rwf >= 0),
  merchant_net_rwf BIGINT NOT NULL CHECK (merchant_net_rwf >= 0),
  total_rwf BIGINT NOT NULL CHECK (total_rwf > 0),
  btc_usd_rate NUMERIC(36, 18) NOT NULL CHECK (btc_usd_rate > 0),
  usd_rwf_rate NUMERIC(36, 18) NOT NULL CHECK (usd_rwf_rate > 0),
  rwf_per_sat NUMERIC(36, 18) NOT NULL CHECK (rwf_per_sat > 0),
  source_updated_at TIMESTAMPTZ NOT NULL,
  sats_amount BIGINT NOT NULL CHECK (sats_amount > 0),
  payment_hash TEXT UNIQUE,
  payment_request TEXT,
  status TEXT NOT NULL CHECK (status IN ('creating', 'awaiting_payment', 'paid', 'expired', 'failed')),
  rate_locked_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merchant_id, id)
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;
UPDATE orders SET source_updated_at = COALESCE(rate_locked_at, created_at) WHERE source_updated_at IS NULL;
ALTER TABLE orders ALTER COLUMN source_updated_at SET NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS short_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS orders_status_expiry_idx ON orders (merchant_id, status, expires_at);

CREATE TABLE IF NOT EXISTS merchant_ledger_entries (
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  order_id TEXT NOT NULL,
  amount_rwf BIGINT NOT NULL CHECK (amount_rwf >= 0),
  kind TEXT NOT NULL CHECK (kind = 'payment'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merchant_id, order_id),
  FOREIGN KEY (merchant_id, order_id) REFERENCES orders(merchant_id, id)
);

CREATE INDEX IF NOT EXISTS merchant_ledger_merchant_idx ON merchant_ledger_entries (merchant_id, created_at);
`;

let pool: Pool | undefined;
let schemaPromise: Promise<void> | undefined;

export function getPool(): Pool {
  if (!pool) {
    const { databaseUrl } = getConfig();
    pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (error) => {
      console.error('PostgreSQL pool error:', error instanceof Error ? error.message : 'unknown error');
    });
  }
  return pool;
}

export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = getPool()
      .query(schemaSql)
      .then(() => undefined)
      .catch((error: unknown) => {
        schemaPromise = undefined;
        throw error;
      });
  }
  await schemaPromise;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, values);
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    schemaPromise = undefined;
  }
}
