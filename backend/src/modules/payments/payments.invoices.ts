import { execute, insertAndGetId, queryOne, transaction, type Row } from '../../db/query';
import { uuid, randomHex } from '../../core/security/crypto';
import { storage } from '../../providers/storage';
import { eventBus } from '../../core/events/event-bus';
import { toNumber } from '../../db/sql';
import { loggerFor } from '../../config/logger';

const log = loggerFor('payments.invoices');

function pdfEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, '?');
}

function buildInvoicePdf(lines: string[]): Buffer {
  const content = ['BT', '/F1 12 Tf', '50 750 Td', ...lines.flatMap((line, index) => (index === 0 ? [`(${pdfEscape(line)}) Tj`] : ['0 -18 Td', `(${pdfEscape(line)}) Tj`])), 'ET'].join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj`,
    `4 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
  ];
  let offset = '%PDF-1.4\n'.length;
  const xref = ['xref', '0 6', '0000000000 65535 f '];
  const body: string[] = [];
  for (const object of objects) {
    xref.push(`${String(offset).padStart(10, '0')} 00000 n `);
    body.push(object);
    offset += object.length + 1;
  }
  const xrefStart = offset;
  return Buffer.from(
    `%PDF-1.4\n${body.join('\n')}\n${xref.join('\n')}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
    'utf8',
  );
}

export async function ensureInvoicePdf(invoiceId: number): Promise<string | null> {
  const invoice = await queryOne<Row>(
    `SELECT id, uuid, invoice_number, user_id, billing_name, total_amount, tax_amount, currency, status, pdf_url
       FROM invoices WHERE id = ?`,
    [invoiceId],
  );
  if (!invoice) return null;
  if (invoice.pdf_url) return String(invoice.pdf_url);

  const items = await queryOne<Row>(
    `SELECT description, total_amount FROM invoice_items WHERE invoice_id = ? ORDER BY id LIMIT 1`,
    [invoiceId],
  );
  const pdf = buildInvoicePdf([
    `Invoice ${String(invoice.invoice_number)}`,
    `Status: ${String(invoice.status)}`,
    `Bill to: ${String(invoice.billing_name ?? 'Customer')}`,
    items ? String(items.description) : 'Marketplace charge',
    `Tax: ${String(invoice.tax_amount ?? '0')} ${String(invoice.currency)}`,
    `Total: ${String(invoice.total_amount)} ${String(invoice.currency)}`,
    'This document contains no payment secrets or card data.',
  ]);
  const path = `document/invoices/${Number(invoice.user_id)}/${String(invoice.uuid)}.pdf`;
  try {
    const stored = await storage.put(path, pdf, 'application/pdf');
    await execute(`UPDATE invoices SET pdf_url = ? WHERE id = ?`, [stored.fileUrl, invoiceId]);
    return stored.fileUrl;
  } catch (error) {
    log.warn({ err: error, invoiceId }, 'invoice pdf write skipped');
    return null;
  }
}

export async function issueOrderInvoice(orderId: number, subscriptionId: number | null = null): Promise<number | null> {
  const existing = await queryOne<Row>('SELECT id FROM invoices WHERE order_id = ?', [orderId]);
  if (existing) {
    await ensureInvoicePdf(Number(existing.id));
    return Number(existing.id);
  }
  const order = await queryOne<Row>(
    `SELECT id, user_id, business_id, subtotal, discount_amount, tax_amount, total_amount, currency, kind
       FROM orders WHERE id = ?`,
    [orderId],
  );
  if (!order) return null;
  const profile = await queryOne<Row>(
    `SELECT u.email, p.display_name FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
    [order.user_id],
  );
  const invoiceId = await insertAndGetId(
    `INSERT INTO invoices
       (uuid, invoice_number, order_id, subscription_id, user_id, business_id, billing_name, billing_email,
        subtotal, discount_amount, tax_amount, total_amount, amount_paid, amount_due, currency, status, issued_at, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'paid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      uuid(),
      `INV-${randomHex(4).toUpperCase()}`,
      orderId,
      subscriptionId,
      order.user_id,
      order.business_id,
      (profile?.display_name as string | null) ?? null,
      (profile?.email as string | null) ?? null,
      order.subtotal,
      order.discount_amount,
      order.tax_amount,
      order.total_amount,
      order.total_amount,
      order.currency,
    ],
  );
  await execute(
    `INSERT INTO invoice_items (invoice_id, description, quantity, unit_amount, total_amount, currency, tax_amount)
     SELECT ?, COALESCE(kind, 'Order'), 1, subtotal, total_amount, currency, tax_amount FROM orders WHERE id = ?`,
    [invoiceId, orderId],
  );
  await ensureInvoicePdf(invoiceId);
  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'invoice.issued', 'invoice', invoiceId, {
      invoiceId,
      userId: Number(order.user_id),
      total: String(order.total_amount),
      currency: String(order.currency),
    });
    void eventBus.publishAfterCommit(event);
  });
  return invoiceId;
}

export async function adjustInvoiceForRefund(orderId: number, refundAmount: number): Promise<void> {
  const invoice = await queryOne<Row>(
    `SELECT id, amount_paid, total_amount FROM invoices WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
    [orderId],
  );
  if (!invoice) return;
  const paid = Math.max(0, (toNumber(invoice.amount_paid) ?? 0) - refundAmount);
  const total = toNumber(invoice.total_amount) ?? 0;
  const status = paid <= 0 ? 'void' : paid + 0.009 < total ? 'open' : 'paid';
  await execute(
    `UPDATE invoices SET amount_paid = ?, amount_due = ?, status = ? WHERE id = ?`,
    [paid, Math.max(0, total - paid), status, invoice.id],
  );
}
