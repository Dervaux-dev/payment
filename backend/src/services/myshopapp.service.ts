/**
 * myShopApp callback service.
 * Called after LND confirms a payment is settled, to notify myShopApp
 * to mark the receipt as paid, deduct stock and record the sale.
 */
import { getConfig } from '../config.js';

export async function notifyMyShopApp(paymentRef: string, processorRef: string): Promise<void> {
  const config = getConfig();
  if (!config.myShopAppUrl || !config.myShopAppPaymentKey) {
    console.warn('[myShopApp] MYSHOPAPP_API_URL or MYSHOPAPP_PAYMENT_KEY not set — skipping callback.');
    return;
  }

  const url = `${config.myShopAppUrl}/api/payments/confirm`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment-key': config.myShopAppPaymentKey,
      },
      body: JSON.stringify({ paymentRef, processorRef }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[myShopApp] Callback failed (${res.status}): ${body}`);
    } else {
      console.log(`[myShopApp] Payment confirmed for ref=${paymentRef}`);
    }
  } catch (err) {
    console.error('[myShopApp] Callback request error:', err instanceof Error ? err.message : err);
  }
}
