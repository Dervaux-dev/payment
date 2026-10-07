import type { QueryResultRow } from 'pg';
import { getConfig } from '../config.js';
import { ensureSchema, query, withTransaction } from '../db.js';
import { CreateInvoice, GetInvoice, type LndInvoiceResponse } from './lightning.service.js';
import { calculatePaymentAmounts, getLockedRate, type RateQuote } from './rate.service.js';

export type OrderStatus = 'creating' | 'awaiting_payment' | 'paid' | 'expired' | 'failed';

type OrderRow = QueryResultRow & {
  merchant_id: string;
  id: string;
  short_id: string;
  description: string;
  amount_rwf: string;
  fee_bps: number;
  fee_rwf: string;
  merchant_net_rwf: string;
  total_rwf: string;
  btc_usd_rate: string;
  usd_rwf_rate: string;
  rwf_per_sat: string;
  source_updated_at: Date | string;
  sats_amount: string;
  payment_hash: string | null;
  payment_request: string | null;
  status: OrderStatus;
  rate_locked_at: Date | string;
  expires_at: Date | string;
  settled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type ShopOrder = {
  orderId: string;
  shortId: string;
  status: OrderStatus;
  description: string;
  amountRwf: string;
  feeRwf: string;
  merchantNetRwf: string;
  totalRwf: string;
  satsAmount: string;
  rate: {
    btcUsd: string;
    usdRwf: string;
    rwfPerSat: string;
    sourceUpdatedAt: string;
    lockedAt: string;
    expiresAt: string;
  };
  invoice: {
    paymentRequest: string;
    paymentHash: string;
  } | null;
  expiresAt: string;
  settledAt: string | null;
};

export type CustomerOrder = {
  orderId: string;
  shortId: string;
  status: OrderStatus;
  totalRwf: string;
  satsAmount: string;
  invoice: {
    paymentRequest: string;
    paymentHash: string;
  } | null;
  expiresAt: string;
  settledAt: string | null;
};

export class OrderServiceError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  public constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = 'OrderServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type CreateOrderInput = {
  orderId: string;
  description: string;
  amountRwf: bigint;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asOptionalDate(value: Date | string | null): string | null {
  return value ? asDate(value).toISOString() : null;
}

function invoiceFor(row: OrderRow): ShopOrder['invoice'] {
  if (!row.payment_request || !row.payment_hash) {
    return null;
  }
  return {
    paymentRequest: row.payment_request,
    paymentHash: row.payment_hash,
  };
}

function toShopOrder(row: OrderRow): ShopOrder {
  return {
    orderId: row.id,
    shortId: row.short_id,
    status: row.status,
    description: row.description,
    amountRwf: row.amount_rwf.toString(),
    feeRwf: row.fee_rwf.toString(),
    merchantNetRwf: row.merchant_net_rwf.toString(),
    totalRwf: row.total_rwf.toString(),
    satsAmount: row.sats_amount.toString(),
    rate: {
      btcUsd: row.btc_usd_rate,
      usdRwf: row.usd_rwf_rate,
      rwfPerSat: row.rwf_per_sat,
      sourceUpdatedAt: asDate(row.source_updated_at).toISOString(),
      lockedAt: asDate(row.rate_locked_at).toISOString(),
      expiresAt: asDate(row.expires_at).toISOString(),
    },
    invoice: invoiceFor(row),
    expiresAt: asDate(row.expires_at).toISOString(),
    settledAt: asOptionalDate(row.settled_at),
  };
}

function toCustomerOrder(row: OrderRow): CustomerOrder {
  return {
    orderId: row.id,
    shortId: row.short_id,
    status: row.status,
    totalRwf: row.total_rwf.toString(),
    satsAmount: row.sats_amount.toString(),
    invoice: invoiceFor(row),
    expiresAt: asDate(row.expires_at).toISOString(),
    settledAt: asOptionalDate(row.settled_at),
  };
}

async function findOrder(merchantId: string, orderId: string): Promise<OrderRow | undefined> {
  const result = await query<OrderRow>(
    `SELECT *
     FROM orders
     WHERE merchant_id = $1 AND id = $2`,
    [merchantId, orderId],
  );
  return result.rows[0];
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function existingOrderResult(row: OrderRow): ShopOrder {
  if (row.status === 'creating') {
    throw new OrderServiceError('ORDER_IN_PROGRESS', 'An order with this ID is already being created', 409);
  }
  if (row.status === 'failed') {
    throw new OrderServiceError('ORDER_FAILED', 'Use a new order ID after a failed order', 409);
  }
  return toShopOrder(row);
}

function expirySeconds(rate: RateQuote): number {
  return Math.max(60, Math.ceil((rate.expiresAt.getTime() - Date.now()) / 1000));
}

export async function createPaymentOrder(input: CreateOrderInput): Promise<ShopOrder> {
  const config = getConfig();
  await ensureSchema();
  const existing = await findOrder(config.merchantId, input.orderId);
  if (existing) {
    return existingOrderResult(existing);
  }

  const rate = await getLockedRate();
  const amounts = calculatePaymentAmounts(input.amountRwf, config.platformFeeBps, rate);
  const expiry = expirySeconds(rate);
  const shortId = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO merchants (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [config.merchantId],
      );
      await client.query(
        `INSERT INTO orders (
           merchant_id, id, short_id, description, amount_rwf, fee_bps, fee_rwf,
           merchant_net_rwf, total_rwf, btc_usd_rate, usd_rwf_rate,
           rwf_per_sat, source_updated_at, sats_amount, status, rate_locked_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'creating', $15, $16)`,
        [
          config.merchantId,
          input.orderId,
          shortId,
          input.description,
          input.amountRwf.toString(),
          config.platformFeeBps,
          amounts.feeRwf.toString(),
          amounts.merchantNetRwf.toString(),
          amounts.totalRwf.toString(),
          rate.btcUsd,
          rate.usdRwf,
          rate.rwfPerSat,
          rate.sourceUpdatedAt,
          amounts.satsAmount.toString(),
          rate.lockedAt,
          rate.expiresAt,
        ],
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const concurrent = await findOrder(config.merchantId, input.orderId);
      if (concurrent) {
        return existingOrderResult(concurrent);
      }
    }
    throw error;
  }

  try {
    const invoice = await CreateInvoice(
      Number(amounts.satsAmount),
      `order:${input.orderId}`,
      expiry,
    );
    await query(
      `UPDATE orders
       SET payment_hash = $3, payment_request = $4, status = 'awaiting_payment', updated_at = NOW()
       WHERE merchant_id = $1 AND id = $2 AND status = 'creating'`,
      [config.merchantId, input.orderId, invoice.paymentHash, invoice.paymentRequest],
    );
  } catch (error) {
    await query(
      `UPDATE orders
       SET status = 'failed', updated_at = NOW()
       WHERE merchant_id = $1 AND id = $2 AND status = 'creating'`,
      [config.merchantId, input.orderId],
    );
    throw error;
  }

  const created = await findOrder(config.merchantId, input.orderId);
  if (!created || created.status !== 'awaiting_payment' || !created.payment_request) {
    throw new OrderServiceError('ORDER_CREATE_FAILED', 'The order could not be finalized', 500);
  }
  return toShopOrder(created);
}

function paidAmount(invoice: LndInvoiceResponse): number | undefined {
  const value = invoice.amt_paid_sat ?? invoice.value_sat;
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isSettled(invoice: LndInvoiceResponse): boolean {
  return invoice.settled === true || invoice.state?.toUpperCase() === 'SETTLED';
}

export async function getPaymentStatus(orderId: string): Promise<CustomerOrder> {
  const config = getConfig();
  await ensureSchema();
  const current = await findOrder(config.merchantId, orderId);
  if (!current) {
    throw new OrderServiceError('ORDER_NOT_FOUND', 'Order not found', 404);
  }
  if (current.status === 'paid' || current.status === 'expired' || current.status === 'failed') {
    return toCustomerOrder(current);
  }
  if (!current.payment_hash) {
    return toCustomerOrder(current);
  }

  const invoice = await GetInvoice(current.payment_hash);
  const returnedHash = invoice.r_hash ?? invoice.payment_hash;
  if (returnedHash && returnedHash !== current.payment_hash) {
    throw new OrderServiceError('INVOICE_MISMATCH', 'LND returned a different invoice', 500);
  }

  if (isSettled(invoice)) {
    const amount = paidAmount(invoice);
    const expected = Number(current.sats_amount);
    if (amount !== undefined && (!Number.isSafeInteger(amount) || amount < expected)) {
      throw new OrderServiceError('INVOICE_AMOUNT_MISMATCH', 'LND reported an insufficient payment', 500);
    }
    await withTransaction(async (client) => {
      const updated = await client.query<OrderRow>(
        `UPDATE orders
         SET status = 'paid', settled_at = COALESCE(settled_at, NOW()), updated_at = NOW()
         WHERE merchant_id = $1 AND id = $2 AND status = 'awaiting_payment'
         RETURNING *`,
        [config.merchantId, orderId],
      );
      if (updated.rowCount === 0) {
        return;
      }
      await client.query(
        `INSERT INTO merchant_ledger_entries (merchant_id, order_id, amount_rwf, kind)
         VALUES ($1, $2, $3, 'payment')
         ON CONFLICT (merchant_id, order_id) DO NOTHING`,
        [config.merchantId, orderId, current.merchant_net_rwf],
      );
    });
  } else if (new Date(current.expires_at).getTime() <= Date.now()) {
    await query(
      `UPDATE orders
       SET status = 'expired', updated_at = NOW()
       WHERE merchant_id = $1 AND id = $2 AND status = 'awaiting_payment'`,
      [config.merchantId, orderId],
    );
  }

  const refreshed = await findOrder(config.merchantId, orderId);
  if (!refreshed) {
    throw new OrderServiceError('ORDER_NOT_FOUND', 'Order not found', 404);
  }
  return toCustomerOrder(refreshed);
}

export async function getMerchantBalance(): Promise<string> {
  const config = getConfig();
  await ensureSchema();
  const result = await query<{ balance: string }>(
    `SELECT COALESCE(SUM(amount_rwf), 0)::text AS balance
     FROM merchant_ledger_entries
     WHERE merchant_id = $1`,
    [config.merchantId],
  );
  return result.rows[0]?.balance ?? '0';
}
