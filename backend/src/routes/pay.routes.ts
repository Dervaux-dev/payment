import { Router } from 'express';
import { initiatePay, pollPay } from '../controllers/pay.controller.js';

const router = Router();

// Public — no API key needed. Called by the buyer's browser.
router.post('/', initiatePay);       // Create / get Lightning invoice
router.get('/:ref', pollPay);        // Poll payment status

export default router;
