import { env } from '../../config/env';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { uuid, randomHex } from '../../core/security/crypto';
import { execute, insertAndGetId, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { loggerFor } from '../../config/logger';
import { eventBus } from '../../core/events/event-bus';
import { emitToUser } from '../../realtime/socket';
import { convertAmount } from '../locale/fx.service';
import {
  estimateFee,
  listGatewaysFor,
  providerMethods,
  resolveGateway,
  type ParsedWebhook,
} from '../../providers/payments';
import { classifyWebhookType } from '../subscriptions/subscriptions.rules';
import { applyPaymentOutcome } from './payments.lifecycle';
import { assessPaymentRisk } from './payments.risk';
import {
  amountsMatch,
  currenciesMatch,
  defaultMethodForProvider,
  mapIntentStatus,
  methodAllowedForProvider,
} from './payments.rules';

const log = loggerFor('payments.orchestrator');

export async function startPaymentForOrder(input: {
  orderId: number;
  userId: number;
  gatewayCode: string;
  paymentMethod?: string | null;
  returnUrl?: string | null;
  displayCurrency?: string | null;
  requestScore?: number;
}): Promise<{
  order: { id: number; uuid: string; orderNumber: string; amount: number; currency: string; taxAmount: number };
  payment: { id: number; intentId: string; status: string; method: string; provider: string };
  intent: { uuid: string; status: string };
  clientSecret: string | null;
  redirectUrl: string | null;
  instructions: string | null;
  risk: { score: number; decision: string };
}> {
  const order = await queryOne<Row>(
    `SELECT id, uuid, order_number, user_id, kind, total_amount, tax_amount, currency, status, country_id, gateway_code
       FROM orders WHERE id = ?`,
    [input.orderId],
  );
  if (!order) throw notFound('Order');
  if (Number(order.user_id) !== input.userId) throw forbidden('Order does not belong to you');

  const currencyRow = await queryOne<Row>('SELECT code FROM currencies WHERE code = ? AND is_active = 1', [
    String(order.currency),
  ]);
  if (!currencyRow) throw badRequest('Unsupported currency');

  const provider = input.gatewayCode;
  const method = input.paymentMethod || defaultMethodForProvider(provider);
  const methods = await providerMethods(provider);
  if (methods.length > 0 && !methodAllowedForProvider(method, provider, methods)) {
    throw badRequest(`Payment method ${method} is not enabled for ${provider}`);
  }
  if (env.isProduction && provider === 'manual') throw badRequest('Manual settlement is not available in production');

  const amount = toNumber(order.total_amount) ?? 0;
  if (amount <= 0) throw badRequest('Amount must be positive');

  const risk = await assessPaymentRisk({
    userId: input.userId,
    amount,
    currency: String(order.currency),
    countryId: order.country_id ? Number(order.country_id) : null,
    requestScore: input.requestScore,
  });
  if (risk.decision === 'block') throw forbidden('This payment was held by risk review');

  const chargeCurrency = String(order.currency);
  const chargeAmount = amount;
  const displayCurrency = (input.displayCurrency ?? chargeCurrency).toUpperCase();
  let displayAmount = chargeAmount;
  let exchangeRate: number | null = 1;
  if (displayCurrency !== chargeCurrency) {
    const converted = await convertAmount(chargeAmount, chargeCurrency, displayCurrency);
    if (converted) {
      displayAmount = converted.amount;
      exchangeRate = converted.rate;
    }
  }
  const settlement = await convertAmount(chargeAmount, chargeCurrency, env.BASE_CURRENCY);

  const fee = await estimateFee(provider, chargeAmount);
  const gateway = await resolveGateway(provider);
  const expires = new Date(Date.now() + (provider === 'bank_transfer' ? 72 : 0.5) * 60 * 60 * 1000);

  const intentId = await insertAndGetId(
    `INSERT INTO payment_intents
       (uuid, order_id, user_id, amount, currency, display_currency, display_amount, charge_currency, charge_amount,
        settlement_currency, settlement_amount, exchange_rate, payment_method, provider, status, risk_score, risk_decision,
        metadata, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    [
      uuid(),
      order.id,
      input.userId,
      chargeAmount,
      chargeCurrency,
      displayCurrency,
      displayAmount,
      chargeCurrency,
      chargeAmount,
      env.BASE_CURRENCY,
      settlement?.amount ?? chargeAmount,
      settlement?.rate ?? exchangeRate,
      method,
      provider,
      Math.round(risk.score),
      risk.decision,
      JSON.stringify({ kind: order.kind, review: risk.decision === 'review' }),
      expires.toISOString().slice(0, 19).replace('T', ' '),
    ],
  );

  const created = await gateway.createIntent({
    orderId: Number(order.id),
    orderUuid: String(order.uuid),
    orderNumber: String(order.order_number),
    userId: input.userId,
    amount: chargeAmount,
    currency: chargeCurrency,
    description: `Order ${order.order_number}`,
    paymentMethod: method,
    returnUrl: input.returnUrl ?? null,
    metadata: { paymentIntentId: intentId, method },
  });

  const intentStatus = mapIntentStatus(created.status);
  await execute(
    `UPDATE payment_intents
        SET provider_reference = ?, status = ?, client_secret = ?, redirect_url = ?, instructions = ?
      WHERE id = ?`,
    [created.intentId, intentStatus, created.clientSecret, created.redirectUrl, created.instructions, intentId],
  );

  const paymentId = await insertAndGetId(
    `INSERT INTO payments
       (uuid, order_id, payment_intent_id, user_id, amount, currency, display_currency, display_amount,
        charge_currency, charge_amount, settlement_currency, settlement_amount, exchange_rate,
        gateway_code, payment_method, gateway_intent_id, status, gateway_fee, risk_score, base_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      order.id,
      intentId,
      input.userId,
      chargeAmount,
      chargeCurrency,
      displayCurrency,
      displayAmount,
      chargeCurrency,
      chargeAmount,
      env.BASE_CURRENCY,
      settlement?.amount ?? chargeAmount,
      settlement?.rate ?? exchangeRate,
      provider,
      method,
      created.intentId,
      intentStatus === 'succeeded' ? 'succeeded' : intentStatus === 'created' ? 'pending' : intentStatus,
      fee,
      Math.round(risk.score),
      settlement?.amount ?? chargeAmount,
    ],
  );

  await execute(`UPDATE orders SET gateway_code = ?, expires_at = COALESCE(expires_at, ?) WHERE id = ?`, [
    provider,
    expires.toISOString().slice(0, 19).replace('T', ' '),
    order.id,
  ]);

  if (provider === 'bank_transfer') {
    const raw = created.raw;
    await insertAndGetId(
      `INSERT INTO bank_transfer_instructions
         (uuid, payment_intent_id, order_id, user_id, reference_code, bank_name, account_name,
          account_number_masked, iban_masked, amount, currency, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        uuid(),
        intentId,
        order.id,
        input.userId,
        String(raw.reference ?? `MP-${randomHex(3).toUpperCase()}`),
        String(raw.bankName ?? 'Marketplace Clearing Bank'),
        String(raw.accountName ?? env.APP_NAME),
        String(raw.accountNumberMasked ?? '****0000'),
        raw.ibanMasked ? String(raw.ibanMasked) : null,
        chargeAmount,
        chargeCurrency,
        expires.toISOString().slice(0, 19).replace('T', ' '),
      ],
    );
  }

  const intent = await queryOne<Row>('SELECT uuid, status FROM payment_intents WHERE id = ?', [intentId]);

  if (created.status === 'succeeded') {
    await applyPaymentOutcome({ paymentId, outcome: 'payment_succeeded', gatewayPaymentId: created.intentId });
  } else {
    await transaction(async (connection) => {
      const event = await eventBus.enqueue(connection, 'payment.pending', 'payment', paymentId, {
        paymentId,
        orderId: Number(order.id),
        orderUuid: String(order.uuid),
        userId: input.userId,
        amount: String(chargeAmount),
        currency: chargeCurrency,
      });
      void eventBus.publishAfterCommit(event);
    });
    emitToUser(input.userId, 'payment:updated', { orderId: Number(order.id), status: intentStatus });
  }

  return {
    order: {
      id: Number(order.id),
      uuid: String(order.uuid),
      orderNumber: String(order.order_number),
      amount: chargeAmount,
      currency: chargeCurrency,
      taxAmount: toNumber(order.tax_amount) ?? 0,
    },
    payment: { id: paymentId, intentId: created.intentId, status: created.status, method, provider },
    intent: { uuid: String(intent?.uuid), status: String(intent?.status ?? intentStatus) },
    clientSecret: created.clientSecret,
    redirectUrl: created.redirectUrl,
    instructions: created.instructions,
    risk: { score: risk.score, decision: risk.decision },
  };
}

export async function getCheckout(orderUuid: string, userId: number, isStaff = false) {
  const order = await queryOne<Row>(
    `SELECT id, uuid, order_number, user_id, kind, subtotal, discount_amount, tax_amount, total_amount,
            currency, status, gateway_code, metadata, paid_at, created_at, expires_at
       FROM orders WHERE uuid = ?`,
    [orderUuid],
  );
  if (!order) throw notFound('Order');
  if (!isStaff && Number(order.user_id) !== userId) throw forbidden('Order does not belong to you');

  const intent = await queryOne<Row>(
    `SELECT uuid, status, payment_method, provider, charge_amount, charge_currency, display_amount, display_currency,
            client_secret, redirect_url, instructions, expires_at
       FROM payment_intents WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
    [order.id],
  );
  const payment = await queryOne<Row>(
    `SELECT uuid, status, amount, currency, gateway_code, payment_method, gateway_intent_id, failure_message
       FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
    [order.id],
  );
  const bank = await queryOne<Row>(
    `SELECT uuid, reference_code, bank_name, account_name, account_number_masked, iban_masked, amount, currency, status, expires_at
       FROM bank_transfer_instructions WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
    [order.id],
  );
  const invoice = await queryOne<Row>(
    `SELECT uuid, invoice_number, total_amount, currency, status, pdf_url FROM invoices WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
    [order.id],
  );

  return {
    order: {
      uuid: String(order.uuid),
      orderNumber: String(order.order_number),
      kind: String(order.kind),
      subtotal: toNumber(order.subtotal) ?? 0,
      discountAmount: toNumber(order.discount_amount) ?? 0,
      taxAmount: toNumber(order.tax_amount) ?? 0,
      totalAmount: toNumber(order.total_amount) ?? 0,
      currency: String(order.currency),
      status: String(order.status),
      paidAt: order.paid_at ? (order.paid_at as Date).toISOString() : null,
      expiresAt: order.expires_at ? (order.expires_at as Date).toISOString() : null,
    },
    intent: intent
      ? {
          uuid: String(intent.uuid),
          status: String(intent.status),
          method: String(intent.payment_method),
          provider: String(intent.provider),
          chargeAmount: toNumber(intent.charge_amount) ?? 0,
          chargeCurrency: String(intent.charge_currency),
          displayAmount: toNumber(intent.display_amount),
          displayCurrency: intent.display_currency ? String(intent.display_currency) : null,
          clientSecret: intent.client_secret ? String(intent.client_secret) : null,
          redirectUrl: intent.redirect_url ? String(intent.redirect_url) : null,
          instructions: intent.instructions ? String(intent.instructions) : null,
        }
      : null,
    payment: payment
      ? {
          uuid: String(payment.uuid),
          status: String(payment.status),
          amount: toNumber(payment.amount) ?? 0,
          currency: String(payment.currency),
          provider: String(payment.gateway_code),
          method: payment.payment_method ? String(payment.payment_method) : null,
          failureMessage: payment.failure_message ? String(payment.failure_message) : null,
        }
      : null,
    bankTransfer: bank
      ? {
          uuid: String(bank.uuid),
          referenceCode: String(bank.reference_code),
          bankName: String(bank.bank_name),
          accountName: String(bank.account_name),
          accountNumberMasked: String(bank.account_number_masked),
          ibanMasked: bank.iban_masked ? String(bank.iban_masked) : null,
          amount: toNumber(bank.amount) ?? 0,
          currency: String(bank.currency),
          status: String(bank.status),
        }
      : null,
    invoice: invoice
      ? {
          uuid: String(invoice.uuid),
          invoiceNumber: String(invoice.invoice_number),
          totalAmount: toNumber(invoice.total_amount) ?? 0,
          currency: String(invoice.currency),
          status: String(invoice.status),
          pdfUrl: invoice.pdf_url ? String(invoice.pdf_url) : null,
        }
      : null,
    authoritative: true,
  };
}

export async function handleProviderWebhook(
  gatewayCode: string,
  rawBody: Buffer | string,
  signature: string | undefined,
) {
  const gateway = await resolveGateway(gatewayCode);
  if (!gateway.verifyWebhook(rawBody, signature)) {
    throw badRequest('Invalid webhook signature');
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw badRequest('Invalid webhook payload');
  }

  const parsed: ParsedWebhook = gateway.parseWebhook(payload);
  const eventId = parsed.eventId || String(payload.id ?? payload.event_id ?? '');
  if (!eventId) throw badRequest('Webhook event id missing');

  const outcome = parsed.outcome === 'unknown' ? classifyWebhookType(parsed.eventType) : parsed.outcome;
  log.info({ gateway: gatewayCode, event: parsed.eventType, outcome, eventId }, 'webhook received');

  const existing = await queryOne<Row>(
    `SELECT id, status FROM webhook_events WHERE gateway_code = ? AND event_id = ?`,
    [gatewayCode, eventId],
  );
  if (existing && String(existing.status) === 'processed') {
    return { received: true, outcome, duplicate: true };
  }
  if (!existing) {
    try {
      await execute(
        `INSERT INTO webhook_events (gateway_code, event_id, event_type, payload, signature_valid, status, attempts)
         VALUES (?, ?, ?, ?, 1, 'processing', 1)`,
        [gatewayCode, eventId, parsed.eventType, JSON.stringify(payload)],
      );
    } catch {
      const raced = await queryOne<Row>(
        `SELECT id, status FROM webhook_events WHERE gateway_code = ? AND event_id = ?`,
        [gatewayCode, eventId],
      );
      if (raced && String(raced.status) === 'processed') {
        return { received: true, outcome, duplicate: true };
      }
    }
  } else {
    await execute(
      `UPDATE webhook_events SET status = 'processing', attempts = attempts + 1, error = NULL WHERE id = ?`,
      [existing.id],
    );
  }

  try {
    const payment = parsed.gatewayIntentId
      ? await queryOne<Row>(
          `SELECT id, order_id, user_id, amount, currency, gateway_code, status FROM payments WHERE gateway_intent_id = ?`,
          [parsed.gatewayIntentId],
        )
      : null;

    if (
      payment &&
      (outcome === 'payment_succeeded' || outcome === 'subscription_renewed' || outcome === 'subscription_created')
    ) {
      if (!amountsMatch(toNumber(payment.amount) ?? 0, parsed.amount)) {
        await recordMismatch('wrong_amount', payment, parsed);
        throw badRequest('Provider amount does not match the order');
      }
      if (!currenciesMatch(String(payment.currency), parsed.currency)) {
        await recordMismatch('wrong_currency', payment, parsed);
        throw badRequest('Provider currency does not match the order');
      }
    }

    const paymentOutcomes = new Set([
      'payment_succeeded',
      'payment_failed',
      'payment_processing',
      'requires_action',
      'refund_succeeded',
      'partial_refund',
      'chargeback',
      'subscription_renewed',
      'subscription_created',
    ]);
    if (payment && paymentOutcomes.has(String(outcome))) {
      if (outcome === 'refund_succeeded' || outcome === 'partial_refund') {
        const refund = await queryOne<Row>(
          `SELECT id, amount FROM refunds WHERE payment_id = ? ORDER BY id DESC LIMIT 1`,
          [payment.id],
        );
        if (refund) {
          await execute(
            `UPDATE refunds SET status = 'succeeded', gateway_refund_id = COALESCE(?, gateway_refund_id), processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [parsed.gatewayRefundId, refund.id],
          );
        }
        await applyPaymentOutcome({
          paymentId: Number(payment.id),
          outcome,
          gatewayPaymentId: parsed.gatewayPaymentId,
          refundId: refund ? Number(refund.id) : null,
          refundAmount: parsed.amount ?? (refund ? toNumber(refund.amount) : null),
        });
      } else {
        await applyPaymentOutcome({
          paymentId: Number(payment.id),
          outcome: outcome as ParsedWebhook['outcome'],
          gatewayPaymentId: parsed.gatewayPaymentId,
          failureMessage: parsed.failureMessage,
        });
      }
    }

    await execute(
      `UPDATE webhook_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP WHERE gateway_code = ? AND event_id = ?`,
      [gatewayCode, eventId],
    );
  } catch (error) {
    await execute(
      `UPDATE webhook_events SET status = 'failed', error = ? WHERE gateway_code = ? AND event_id = ?`,
      [String(error).slice(0, 2000), gatewayCode, eventId],
    );
    throw error;
  }

  return { received: true, outcome, duplicate: false };
}

async function recordMismatch(
  kind: 'wrong_amount' | 'wrong_currency',
  payment: Row,
  parsed: ParsedWebhook,
): Promise<void> {
  log.error(
    { paymentId: payment.id, expected: payment.amount, actual: parsed.amount, currency: parsed.currency, kind },
    'webhook does not match stored payment',
  );
  const reconId = await insertAndGetId(
    `INSERT INTO payment_reconciliation
       (uuid, provider, period_start, period_end, status, currency, amount_mismatch_count, currency_mismatch_count, notes)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'mismatch', ?, ?, ?, 'webhook mismatch')`,
    [
      uuid(),
      String(payment.gateway_code),
      String(payment.currency),
      kind === 'wrong_amount' ? 1 : 0,
      kind === 'wrong_currency' ? 1 : 0,
    ],
  );
  await execute(
    `INSERT INTO payment_reconciliation_items
       (reconciliation_id, kind, payment_id, provider_transaction_id, expected_amount, actual_amount, currency, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reconId,
      kind,
      payment.id,
      parsed.gatewayPaymentId,
      payment.amount,
      parsed.amount,
      parsed.currency ?? payment.currency,
      JSON.stringify({ eventType: parsed.eventType, eventId: parsed.eventId }),
    ],
  );
}

export async function listAvailableMethods(countryIso2: string | null, currency: string | null, countryId: number | null) {
  const providers = await listGatewaysFor(countryIso2, currency);
  const regional = countryId
    ? await queryRows<Row>(
        `SELECT provider_code, payment_method FROM regional_payment_methods
          WHERE country_id = ? AND is_enabled = 1 AND (? IS NULL OR currency = ?)
          ORDER BY sort_order`,
        [countryId, currency, currency],
      )
    : [];
  const methods = [
    ...new Set([
      ...providers.flatMap((item) => item.methods),
      ...regional.map((row) => String(row.payment_method)),
    ]),
  ];
  return { providers, methods, regional: regional.map((row) => ({ provider: String(row.provider_code), method: String(row.payment_method) })) };
}

export async function submitBankProof(orderUuid: string, userId: number, storagePath: string, mimeType: string) {
  if (!storagePath.startsWith('document/') && !storagePath.startsWith('verification/')) {
    throw badRequest('Proof must be an uploaded document');
  }
  const order = await queryOne<Row>('SELECT id, user_id FROM orders WHERE uuid = ?', [orderUuid]);
  if (!order) throw notFound('Order');
  if (Number(order.user_id) !== userId) throw forbidden('Order does not belong to you');
  const instruction = await queryOne<Row>(
    `SELECT id FROM bank_transfer_instructions WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
    [order.id],
  );
  if (!instruction) throw badRequest('No bank transfer is pending for this order');
  const id = await insertAndGetId(
    `INSERT INTO bank_transfer_proofs (uuid, instruction_id, user_id, storage_path, mime_type, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [uuid(), instruction.id, userId, storagePath, mimeType],
  );
  return { proofUuid: (await queryOne<Row>('SELECT uuid FROM bank_transfer_proofs WHERE id = ?', [id]))?.uuid, status: 'pending', settlesPayment: false };
}

export async function reviewBankProof(proofUuid: string, staffId: number, approved: boolean, notes?: string) {
  const proof = await queryOne<Row>('SELECT id, instruction_id FROM bank_transfer_proofs WHERE uuid = ?', [proofUuid]);
  if (!proof) throw notFound('Proof');
  await execute(
    `UPDATE bank_transfer_proofs SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, notes = ? WHERE id = ?`,
    [approved ? 'approved' : 'rejected', staffId, notes ?? null, proof.id],
  );
  return { reviewed: true, approved, settlesPayment: false };
}

export async function confirmBankTransfer(orderUuid: string, staffId: number) {
  const order = await queryOne<Row>('SELECT id FROM orders WHERE uuid = ?', [orderUuid]);
  if (!order) throw notFound('Order');
  const payment = await queryOne<Row>(
    `SELECT id FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
    [order.id],
  );
  if (!payment) throw notFound('Payment');
  await execute(
    `UPDATE bank_transfer_instructions SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE order_id = ?`,
    [order.id],
  );
  log.info({ orderUuid, staffId }, 'bank transfer confirmed by operations');
  await applyPaymentOutcome({
    paymentId: Number(payment.id),
    outcome: 'payment_succeeded',
    gatewayPaymentId: `bank_confirm_${staffId}`,
  });
  return { paid: true };
}
