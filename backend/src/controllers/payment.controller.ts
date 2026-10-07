import type { Request, Response } from 'express';
import {
  createPaymentOrder,
  getMerchantBalance,
  getPaymentStatus,
  OrderServiceError,
} from '../services/order.service.js';

function parseOrderId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const orderId = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(orderId)) {
    return undefined;
  }
  return orderId;
}

function parseDescription(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const description = value.trim();
  if (description.length === 0 || description.length > 200) {
    return undefined;
  }
  return description;
}

function parseRwfAmount(value: unknown): bigint | undefined {
  try {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value <= 0) {
        return undefined;
      }
      return BigInt(value);
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      return undefined;
    }
    const amount = BigInt(value);
    if (amount <= 0n || amount > 9_000_000_000_000_000_000n) {
      return undefined;
    }
    return amount;
  } catch {
    return undefined;
  }
}

function sendError(res: Response, error: unknown): Response {
  if (error instanceof OrderServiceError) {
    return res.status(error.statusCode).json({ error: error.message, code: error.code });
  }
  console.error('Payment order error:', error instanceof Error ? error.message : error);
  return res.status(500).json({ error: 'Payment order operation failed' });
}

export const createOrder = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { orderId?: unknown; description?: unknown; amountRwf?: unknown };
  const orderId = parseOrderId(body.orderId);
  const description = parseDescription(body.description);
  const amountRwf = parseRwfAmount(body.amountRwf);

  if (!orderId || !description || !amountRwf) {
    return res.status(400).json({
      error: 'orderId, description, and a positive integer amountRwf are required',
    });
  }

  try {
    const order = await createPaymentOrder({ orderId, description, amountRwf });
    return res.status(201).json({ order });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getOrder = async (req: Request, res: Response) => {
  const orderId = parseOrderId(req.params.orderId);
  if (!orderId) {
    return res.status(400).json({ error: 'A valid orderId is required' });
  }

  try {
    const order = await getPaymentStatus(orderId);
    return res.status(200).json({ order });
  } catch (error) {
    return sendError(res, error);
  }
};

export const getBalance = async (_req: Request, res: Response) => {
  try {
    const balanceRwf = await getMerchantBalance();
    return res.status(200).json({ balanceRwf });
  } catch (error) {
    return sendError(res, error);
  }
};
