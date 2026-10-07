function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function optionalEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export type AppConfig = {
  databaseUrl: string;
  merchantId: string;
  shopApiKey: string;
  platformFeeBps: number;
  rateLockSeconds: number;
  coingeckoApiUrl: string;
  coingeckoApiKey: string | undefined;
  coingeckoApiKeyHeader: string;
  fxApiUrl: string;
  coingeckoMaxAgeSeconds: number;
  fxMaxAgeSeconds: number;
  myShopAppUrl: string | undefined;
  myShopAppPaymentKey: string | undefined;
};

export function getConfig(): AppConfig {
  return {
    databaseUrl: requiredEnvironment('DATABASE_URL'),
    merchantId: requiredEnvironment('MERCHANT_ID'),
    shopApiKey: requiredEnvironment('SHOP_API_KEY'),
    platformFeeBps: boundedInteger('PLATFORM_FEE_BPS', 100, 0, 9999),
    rateLockSeconds: boundedInteger('RATE_LOCK_SECONDS', 900, 60, 86400),
    coingeckoApiUrl: optionalEnvironment('COINGECKO_API_URL') ?? 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_last_updated_at=true',
    coingeckoApiKey: optionalEnvironment('COINGECKO_API_KEY'),
    coingeckoApiKeyHeader: optionalEnvironment('COINGECKO_API_KEY_HEADER') ?? 'x-cg-demo-api-key',
    fxApiUrl: optionalEnvironment('FX_API_URL') ?? 'https://open.er-api.com/v6/latest/USD',
    coingeckoMaxAgeSeconds: boundedInteger('COINGECKO_MAX_AGE_SECONDS', 1800, 60, 86400),
    fxMaxAgeSeconds: boundedInteger('FX_MAX_AGE_SECONDS', 172800, 3600, 604800),
    myShopAppUrl: optionalEnvironment('MYSHOPAPP_API_URL'),
    myShopAppPaymentKey: optionalEnvironment('MYSHOPAPP_PAYMENT_KEY'),
  };
}
