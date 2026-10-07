import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { getConfig } from './config.js';

function matchesSecret(provided: string, expected: string): boolean {
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export const requireShopKey: RequestHandler = (req, res, next) => {
  try {
    const expected = getConfig().shopApiKey;
    const provided = req.header('x-shop-api-key') ?? '';
    if (!provided || !matchesSecret(provided, expected)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  } catch {
    res.status(500).json({ error: 'Shop authentication is not configured' });
  }
};
