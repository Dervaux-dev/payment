import { Router } from 'express';
import { createOrder, getBalance, getOrder } from '../controllers/payment.controller.js';
import { requireShopKey } from '../shop-auth.js';

const router = Router();

router.post('/orders', requireShopKey, createOrder);
router.get('/orders/:orderId', getOrder);
router.get('/merchant/balance', requireShopKey, getBalance);

export default router;
