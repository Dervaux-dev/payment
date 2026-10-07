# MyPayment API

MyPayment exposes a lightweight payment API for merchant order creation and buyer-facing Lightning invoice flows.

The backend listens on `PORT` (default: `3000`) and provides:

- Merchant endpoints under `/api/payments`
- Public buyer endpoints under `/api/pay`
- Health check on `/health`

## Base URL

By default:

```bash
http://localhost:3000
```

## Authentication

Merchant-only routes require the `x-shop-api-key` header.

```http
x-shop-api-key: <shop-api-key>
```

The API compares the provided value against the configured `SHOP_API_KEY` using a SHA-256 digest check. Requests without a valid key receive `401 Unauthorized`.

## Common response shape

Successful responses are JSON objects. Failed requests return an object like:

```json
{
  "error": "A valid orderId is required",
  "code": "ORDER_INVALID"
}
```

Error codes vary by endpoint and may include:

- `ORDER_NOT_FOUND`
- `ORDER_IN_PROGRESS`
- `ORDER_FAILED`
- `ORDER_CREATE_FAILED`
- `INVOICE_MISMATCH`
- `INVOICE_AMOUNT_MISMATCH`

## Endpoints

### 1) Health check

#### GET `/health`

Returns the service status.

Example response:

```json
{
  "status": "ok"
}
```

Status code: `200 OK`

---

### 2) Merchant: create order

#### POST `/api/payments/orders`

Creates a merchant-side payment order.

Headers:

```http
Content-Type: application/json
x-shop-api-key: <shop-api-key>
```

Request body:

```json
{
  "orderId": "ORDER-123",
  "description": "Coffee beans",
  "amountRwf": 1500
}
```

Validation rules:

- `orderId`: alphanumeric plus `.`, `_`, `:`, `-`, length 1-100
- `description`: required, 1-200 chars
- `amountRwf`: positive integer in RWF

Example success response (`201 Created`):

```json
{
  "order": {
    "orderId": "ORDER-123",
    "shortId": "483291",
    "status": "awaiting_payment",
    "description": "Coffee beans",
    "amountRwf": "1500",
    "feeRwf": "15",
    "merchantNetRwf": "1485",
    "totalRwf": "1515",
    "satsAmount": "123",
    "rate": {
      "btcUsd": "....",
      "usdRwf": "....",
      "rwfPerSat": "....",
      "sourceUpdatedAt": "2026-10-07T12:00:00.000Z",
      "lockedAt": "2026-10-07T12:00:00.000Z",
      "expiresAt": "2026-10-07T12:15:00.000Z"
    },
    "invoice": {
      "paymentRequest": "lnbc1...",
      "paymentHash": "..."
    },
    "expiresAt": "2026-10-07T12:15:00.000Z",
    "settledAt": null
  }
}
```

Possible errors:

- `400 Bad Request`: invalid order payload
- `401 Unauthorized`: missing/invalid `x-shop-api-key`
- `409 Conflict`: duplicate order ID while creation is in progress or previous failed attempt
- `500 Internal Server Error`: backend or Lightning error

---

### 3) Merchant: get order status

#### GET `/api/payments/orders/:orderId`

Fetches a merchant-side payment order.

Headers:

```http
x-shop-api-key: <shop-api-key>
```

Example response (`200 OK`):

```json
{
  "order": {
    "orderId": "ORDER-123",
    "shortId": "483291",
    "status": "paid",
    "description": "Coffee beans",
    "amountRwf": "1500",
    "feeRwf": "15",
    "merchantNetRwf": "1485",
    "totalRwf": "1515",
    "satsAmount": "123",
    "rate": {
      "btcUsd": "....",
      "usdRwf": "....",
      "rwfPerSat": "....",
      "sourceUpdatedAt": "2026-10-07T12:00:00.000Z",
      "lockedAt": "2026-10-07T12:00:00.000Z",
      "expiresAt": "2026-10-07T12:15:00.000Z"
    },
    "invoice": {
      "paymentRequest": "lnbc1...",
      "paymentHash": "..."
    },
    "expiresAt": "2026-10-07T12:15:00.000Z",
    "settledAt": "2026-10-07T12:10:00.000Z"
  }
}
```

Accepted statuses:

- `creating`
- `awaiting_payment`
- `paid`
- `expired`
- `failed`

---

### 4) Merchant: get account balance

#### GET `/api/payments/merchant/balance`

Returns the accumulated merchant ledger balance in RWF.

Headers:

```http
x-shop-api-key: <shop-api-key>
```

Example response:

```json
{
  "balanceRwf": "215000"
}
```

Status code: `200 OK`

---

### 5) Public buyer: create a Lightning invoice

#### POST `/api/pay`

Creates or reuses a Lightning invoice for a buyer checkout flow. This endpoint is public and does not require an API key.

Request body:

```json
{
  "ref": "payment-abc123",
  "amount": 1500,
  "currency": "RWF"
}
```

Validation rules:

- `ref`: 4-128 chars, matches `^[A-Za-z0-9_\-]+$`
- `amount`: positive numeric value in RWF
- `currency`: currently only `RWF` is accepted

Example response (`200 OK`):

```json
{
  "orderId": "payment-abc123",
  "shortId": "483291",
  "status": "awaiting_payment",
  "totalRwf": "1515",
  "satsAmount": "123",
  "invoice": {
    "paymentRequest": "lnbc1...",
    "paymentHash": "..."
  },
  "expiresAt": "2026-10-07T12:15:00.000Z"
}
```

---

### 6) Public buyer: poll payment status

#### GET `/api/pay/:ref`

Checks the current status of a public payment referenced by `ref`.

Example request:

```bash
curl http://localhost:3000/api/pay/payment-abc123
```

Example response:

```json
{
  "orderId": "payment-abc123",
  "shortId": "483291",
  "status": "paid",
  "totalRwf": "1515",
  "satsAmount": "123",
  "invoice": {
    "paymentRequest": "lnbc1...",
    "paymentHash": "..."
  },
  "expiresAt": "2026-10-07T12:15:00.000Z",
  "settledAt": "2026-10-07T12:10:00.000Z"
}
```

When the payment is marked as `paid`, the backend also triggers a best-effort callback to the configured `MYSHOPAPP_API_URL` if that integration is enabled.

---

## Example cURL flow

Create a merchant order:

```bash
curl -X POST http://localhost:3000/api/payments/orders \
  -H 'Content-Type: application/json' \
  -H 'x-shop-api-key: <shop-api-key>' \
  -d '{
    "orderId": "ORDER-123",
    "description": "Coffee beans",
    "amountRwf": 1500
  }'
```

Create a buyer invoice:

```bash
curl -X POST http://localhost:3000/api/pay \
  -H 'Content-Type: application/json' \
  -d '{
    "ref": "payment-abc123",
    "amount": 1500,
    "currency": "RWF"
  }'
```

Check payment status:

```bash
curl http://localhost:3000/api/pay/payment-abc123
```

## Environment variables

The backend expects the following variables when running in production or local development:

Required:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/db
MERCHANT_ID=my-merchant-id
SHOP_API_KEY=super-secret-key
```

Optional with defaults:

```bash
PORT=3000
PLATFORM_FEE_BPS=100
RATE_LOCK_SECONDS=900
COINGECKO_API_URL=https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_last_updated_at=true
COINGECKO_API_KEY=
COINGECKO_API_KEY_HEADER=x-cg-demo-api-key
FX_API_URL=https://open.er-api.com/v6/latest/USD
COINGECKO_MAX_AGE_SECONDS=1800
FX_MAX_AGE_SECONDS=172800
MYSHOPAPP_API_URL=
MYSHOPAPP_PAYMENT_KEY=
```

## Notes

- Merchant routes are protected by the shop API key.
- Public `/api/pay` routes are designed for buyer-browser flows and do not require keys.
- `amountRwf` and buyer payment amounts are treated as integer RWF values, with conversion and exchange-rate locking handled internally.
