import express from 'express';
import { closePool } from './db.js';
import paymentRoutes from './routes/payment.routes.js';
import payRoutes from './routes/pay.routes.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

app.use(express.json({ limit: '16kb' }));

// Allow browser requests from any origin (buyer's phone browser opens the QR URL)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-shop-api-key');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
app.use('/api/payments', paymentRoutes);
app.use('/api/pay', payRoutes);

const server = app.listen(port, () => {
  console.log(`Server is running on port http://localhost:${port}`);
});

const shutdown = () => {
  server.close(() => {
    closePool().finally(() => process.exit(0));
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

