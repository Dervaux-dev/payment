import { getConfig } from '../config.js';

type JsonRecord = Record<string, unknown>;

type Rational = {
  numerator: bigint;
  denominator: bigint;
};

export type RateQuote = {
  btcUsd: string;
  usdRwf: string;
  rwfPerSat: string;
  rwfPerSatNumerator: bigint;
  rwfPerSatDenominator: bigint;
  sourceUpdatedAt: string;
  lockedAt: Date;
  expiresAt: Date;
};

type CachedRates = {
  btcUsd: Rational;
  usdRwf: Rational;
  btcUsdText: string;
  usdRwfText: string;
  sourceUpdatedAt: string;
  fetchedAt: number;
};

let cachedRates: CachedRates | undefined;

function asRecord(value: unknown, name: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} returned an invalid response`);
  }
  return value as JsonRecord;
}

function decimalText(value: unknown, name: string): string {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`${name} is missing`);
  }
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    throw new Error(`${name} is not a valid decimal`);
  }
  return text;
}

function parseDecimal(value: unknown, name: string): Rational {
  const text = decimalText(value, name);
  const parts = text.split('.');
  const whole = parts[0] ?? '0';
  const fraction = parts[1] ?? '';
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || '0');
  return { numerator, denominator };
}

function multiply(left: Rational, right: Rational): Rational {
  return {
    numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator,
  };
}

function formatRational(value: Rational, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const scaled = (value.numerator * scale) / value.denominator;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(decimals, '0');
  return decimals > 0 ? `${whole}.${fraction}` : whole.toString();
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  if (numerator <= 0n || denominator <= 0n) {
    throw new Error('Invalid positive rational calculation');
  }
  return (numerator + denominator - 1n) / denominator;
}

function assertFresh(timestampMs: number, maximumAgeSeconds: number, name: string): void {
  const age = Date.now() - timestampMs;
  if (age < -300000 || age > maximumAgeSeconds * 1000) {
    throw new Error(`${name} rate is stale`);
  }
}

async function fetchJson(url: string, headers: Record<string, string>, name: string): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`${name} returned HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

async function fetchRates(): Promise<CachedRates> {
  const config = getConfig();
  const cryptoHeaders: Record<string, string> = { Accept: 'application/json' };
  if (config.coingeckoApiKey) {
    cryptoHeaders[config.coingeckoApiKeyHeader] = config.coingeckoApiKey;
  }
  const fxHeaders: Record<string, string> = { Accept: 'application/json' };

  const [cryptoResponse, fxResponse] = await Promise.all([
    fetchJson(config.coingeckoApiUrl, cryptoHeaders, 'CoinGecko'),
    fetchJson(config.fxApiUrl, fxHeaders, 'FX rate provider'),
  ]);
  const crypto = asRecord(cryptoResponse, 'CoinGecko');
  const bitcoin = asRecord(crypto.bitcoin, 'CoinGecko bitcoin');
  const btcUsdText = decimalText(bitcoin.usd, 'BTC/USD');
  const btcUsd = parseDecimal(btcUsdText, 'BTC/USD');
  if (btcUsd.numerator <= 0n) {
    throw new Error('BTC/USD rate must be positive');
  }
  const btcTimestamp = Number(bitcoin.last_updated_at);
  if (!Number.isFinite(btcTimestamp)) {
    throw new Error('CoinGecko did not return a rate timestamp');
  }
  assertFresh(btcTimestamp * 1000, config.coingeckoMaxAgeSeconds, 'BTC/USD');

  const fx = asRecord(fxResponse, 'FX rate provider');
  if (fx.result !== undefined && fx.result !== 'success') {
    throw new Error('FX rate provider returned an unsuccessful response');
  }
  const rates = asRecord(fx.rates, 'FX rates');
  const usdRwfText = decimalText(rates.RWF, 'USD/RWF');
  const usdRwf = parseDecimal(usdRwfText, 'USD/RWF');
  if (usdRwf.numerator <= 0n) {
    throw new Error('USD/RWF rate must be positive');
  }
  const fxTimestamp = Number(fx.time_last_update_unix);
  if (!Number.isFinite(fxTimestamp)) {
    throw new Error('FX rate provider did not return a rate timestamp');
  }
  assertFresh(fxTimestamp * 1000, config.fxMaxAgeSeconds, 'USD/RWF');

  const sourceUpdatedAt = new Date(Math.min(btcTimestamp, fxTimestamp) * 1000).toISOString();
  return {
    btcUsd,
    usdRwf,
    btcUsdText,
    usdRwfText,
    sourceUpdatedAt,
    fetchedAt: Date.now(),
  };
}

async function getRates(): Promise<CachedRates> {
  if (cachedRates && Date.now() - cachedRates.fetchedAt < 30000) {
    return cachedRates;
  }
  cachedRates = await fetchRates();
  return cachedRates;
}

export async function getLockedRate(): Promise<RateQuote> {
  const config = getConfig();
  const rates = await getRates();
  const rwfPerSat = multiply(multiply(rates.btcUsd, rates.usdRwf), {
    numerator: 1n,
    denominator: 100000000n,
  });
  const lockedAt = new Date();
  const expiresAt = new Date(lockedAt.getTime() + config.rateLockSeconds * 1000);

  return {
    btcUsd: rates.btcUsdText,
    usdRwf: rates.usdRwfText,
    rwfPerSat: formatRational(rwfPerSat, 18),
    rwfPerSatNumerator: rwfPerSat.numerator,
    rwfPerSatDenominator: rwfPerSat.denominator,
    sourceUpdatedAt: rates.sourceUpdatedAt,
    lockedAt,
    expiresAt,
  };
}

export type PaymentAmounts = {
  feeRwf: bigint;
  merchantNetRwf: bigint;
  totalRwf: bigint;
  satsAmount: bigint;
};

export function calculatePaymentAmounts(amountRwf: bigint, feeBps: number, rate: RateQuote): PaymentAmounts {
  if (amountRwf <= 0n) {
    throw new Error('Amount must be positive');
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10000) {
    throw new Error('Fee configuration is invalid');
  }
  const feeRwf = ceilDivide(amountRwf * BigInt(feeBps), 10000n);
  const merchantNetRwf = amountRwf - feeRwf;
  if (merchantNetRwf < 0n) {
    throw new Error('Fee cannot exceed the order amount');
  }
  const satsAmount = ceilDivide(
    amountRwf * rate.rwfPerSatDenominator,
    rate.rwfPerSatNumerator,
  );
  return {
    feeRwf,
    merchantNetRwf,
    totalRwf: amountRwf,
    satsAmount,
  };
}
