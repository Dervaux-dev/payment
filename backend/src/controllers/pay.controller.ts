/**
 * Public pay endpoint — no API key required.
 * Called by the mypayment browser frontend when a buyer opens the QR URL:
 *   https://<mypayment-frontend>/?ref=<paymentRef>&amount=1500.00&currency=RWF
 *
 * Creates (or retrieves) a Lightning invoice for the given paymentRef,
 * then returns the Lightning paymentRequest for the buyer to pay.
 */
import type { Request, Response } from 'express';
import {
  createPaymentOrder,
  getPaymentStatus,
  OrderServiceError,
} from '../services/order.service.js';
import { notifyMyShopApp } from '../services/myshopapp.service.js';

function sendError(res: Response, error: unknown): Response {
  if (error instanceof OrderServiceError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  console.error('Pay endpoint error:', error instanceof Error ? error.message : error);
  return res.status(500).json({ error: 'Internal server error' });
}

/**
 * POST /api/pay
 * Body: { ref: string, amount: number, currency: string }
 * Creates (idempotent) a Lightning invoice for the given myShopApp paymentRef.
 */
export const initiatePay = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { ref?: unknown; amount?: unknown; currency?: unknown };

  const ref = typeof body.ref === 'string' ? body.ref.trim() : undefined;
  const amountRaw = body.amount;
  const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : 'RWF';

  if (!ref || !/^[A-Za-z0-9_\-]{4,128}$/.test(ref)) {
    return res.status(400).json({ error: 'A valid payment ref is required.' });
  }
  if (currency !== 'RWF') {
    return res.status(400).json({ error: `Unsupported currency: ${currency}. Only RWF is accepted.` });
  }

  let amountRwf: bigint;
  try {
    const parsed = typeof amountRaw === 'string' ? parseFloat(amountRaw) : Number(amountRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error();
    amountRwf = BigInt(Math.round(parsed));
  } catch {
    return res.status(400).json({ error: 'amount must be a positive number in RWF.' });
  }

  try {
    const order = await createPaymentOrder({
      orderId: ref,
      description: `myShopApp payment ${ref}`,
      amountRwf,
    });

    return res.status(200).json({
      orderId: order.orderId,
      shortId: order.shortId,
      status: order.status,
      totalRwf: order.totalRwf,
      satsAmount: order.satsAmount,
      invoice: order.invoice,
      expiresAt: order.expiresAt,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

/**
 * GET /api/pay/:ref
 * Polls the current status of a payment for the buyer's browser.
 */
export const pollPay = async (req: Request, res: Response) => {
  const ref = typeof req.params.ref === 'string' ? req.params.ref.trim() : undefined;
  if (!ref) {
    return res.status(400).json({ error: 'ref is required.' });
  }

  try {
    const order = await getPaymentStatus(ref);

    // If payment just settled, fire callback to myShopApp (best-effort)
    if (order.status === 'paid') {
      notifyMyShopApp(ref, order.orderId).catch(() => {/* already logged inside */});
    }

    return res.status(200).json({
      orderId: order.orderId,
      shortId: order.shortId,
      status: order.status,
      totalRwf: order.totalRwf,
      satsAmount: order.satsAmount,
      invoice: order.invoice,
      expiresAt: order.expiresAt,
      settledAt: order.settledAt,
    });
  } catch (error) {
    return sendError(res, error);
  }
};
