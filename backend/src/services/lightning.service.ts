import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';

export type LndInvoiceResponse = {
  payment_request?: string;
  paymentRequest?: string;
  r_hash?: string;
  payment_hash?: string;
  value?: number | string;
  value_sat?: number | string;
  amt_paid_sat?: number | string;
  settled?: boolean;
  state?: string;
  memo?: string;
  creation_date?: number | string;
  settle_date?: number | string;
  expiry?: number | string;
};

export type LndInvoice = {
  paymentRequest: string;
  paymentHash: string;
  valueSat: number;
};

type LndConfig = {
  endpoint: string;
  certificate: Buffer;
  macaroon: string;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function resolveCertificatePath(value: string): string {
  if (process.platform !== 'win32') {
    return value;
  }
  if (value.startsWith('/mnt/')) {
    const parts = value.split('/').filter(Boolean);
    const drive = parts[1]?.toUpperCase();
    if (drive && parts.length > 2) {
      return `${drive}:\\${parts.slice(2).join('\\')}`;
    }
  }
  if (value.startsWith('/')) {
    return `\\\\wsl.localhost\\Ubuntu${value.replace(/\//g, '\\')}`;
  }
  return value;
}

async function getLndConfig(): Promise<LndConfig> {
  const endpoint = requiredEnvironment('LND_REST_ENDPOINT');
  const certificateValue = requiredEnvironment('LND_REST_CERT');
  const macaroonValue = requiredEnvironment('LND_REST_MACAROON');
  const endpointUrl = new URL(endpoint);

  if (endpointUrl.protocol !== 'https:') {
    throw new Error('LND_REST_ENDPOINT must use HTTPS');
  }

  const certificate = certificateValue.includes('-----BEGIN')
    ? Buffer.from(certificateValue.replace(/\\n/g, '\n'))
    : await readFile(resolveCertificatePath(certificateValue));
  const macaroon = macaroonValue.replace(/^0x/i, '').toLowerCase();

  if (!/^[0-9a-f]+$/.test(macaroon) || macaroon.length % 2 !== 0) {
    throw new Error('LND_REST_MACAROON must be a hexadecimal string');
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    certificate,
    macaroon,
  };
}

function errorMessage(value: unknown, status: number): string {
  if (typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string') {
    return value.message;
  }
  return `LND request failed with status ${status}`;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizePaymentHash(value: string): string {
  const text = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(text)) {
    return text.toLowerCase();
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    const decoded = Buffer.from(text, 'base64');
    if (decoded.length === 32) {
      return decoded.toString('hex');
    }
  }
  throw new Error('LND returned an invalid payment hash');
}

function requestJson<T>(
  config: LndConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = new URL(`${config.endpoint}${path}`);
  const payload = body === undefined ? undefined : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method,
        ca: config.certificate,
        rejectUnauthorized: true,
        headers: {
          Accept: 'application/json',
          ...(payload === undefined ? {} : {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }),
          'Grpc-Metadata-macaroon': config.macaroon,
        },
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            reject(new Error(`LND returned invalid JSON with status ${status}`));
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new Error(errorMessage(parsed, status)));
            return;
          }
          resolve(parsed as T);
        });
      },
    );

    request.setTimeout(10000, () => {
      request.destroy(new Error('LND request timed out'));
    });
    request.on('error', reject);
    if (payload !== undefined) {
      request.write(payload);
    }
    request.end();
  });
}

export async function CreateInvoice(amountSat: number, memo: string, expirySeconds: number): Promise<LndInvoice> {
  try {
    if (!Number.isSafeInteger(amountSat) || amountSat <= 0) {
      throw new Error('Invoice amount must be a positive safe integer');
    }
    if (!Number.isInteger(expirySeconds) || expirySeconds < 60 || expirySeconds > 86400) {
      throw new Error('Invoice expiry is invalid');
    }
    const config = await getLndConfig();
    const response = await requestJson<LndInvoiceResponse>(config, 'POST', '/v1/invoices', {
      value: amountSat,
      memo,
      expiry: expirySeconds,
    });
    const paymentRequest = response.payment_request ?? response.paymentRequest;
    const rawPaymentHash = response.r_hash ?? response.payment_hash;
    const reportedValueSat = numericValue(response.value_sat) ?? numericValue(response.value);
    if (!paymentRequest || !rawPaymentHash) {
      throw new Error('LND did not return a complete invoice');
    }
    if (reportedValueSat !== undefined && reportedValueSat !== amountSat) {
      throw new Error('LND returned an unexpected invoice amount');
    }
    return {
      paymentRequest,
      paymentHash: normalizePaymentHash(rawPaymentHash),
      valueSat: amountSat,
    };
  } catch (error) {
    console.error('Error creating LND invoice:', error);
    throw new Error('Failed to create Lightning invoice');
  }
}

export async function GetInvoice(paymentHash: string): Promise<LndInvoiceResponse> {
  try {
    const normalizedPaymentHash = normalizePaymentHash(paymentHash);
    const config = await getLndConfig();
    const response = await requestJson<LndInvoiceResponse>(
      config,
      'GET',
      `/v1/invoice/${encodeURIComponent(normalizedPaymentHash)}`,
    );
    const rawPaymentHash = response.r_hash ?? response.payment_hash;
    if (rawPaymentHash) {
      const normalizedResponseHash = normalizePaymentHash(rawPaymentHash);
      return {
        ...response,
        r_hash: normalizedResponseHash,
        payment_hash: normalizedResponseHash,
      };
    }
    return response;
  } catch (error) {
    console.error('Error reading LND invoice:', error);
    throw new Error('Failed to read Lightning invoice');
  }
}

export const GenerateInvoice = async (amount: number, memo: string): Promise<string> => {
  const invoice = await CreateInvoice(amount, memo, 900);
  return invoice.paymentRequest;
};
