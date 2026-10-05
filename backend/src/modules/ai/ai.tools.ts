import { z } from 'zod';
import { queryOne, queryRows, type Row } from '../../db/query';
import { AppError, ErrorCode, forbidden, notFound } from '../../core/errors';
import { getListing } from '../listings/listings.service';
import { getOrder } from '../payments/payments.service';
import { getCurrentSubscription } from '../subscriptions/subscriptions.service';
import { createTicket } from '../support/support.service';

export interface ToolDefinition {
  name: string;
  description: string;
  permission: 'public' | 'authenticated' | 'owner' | 'confirm';
  rateLimit: number;
  audit: boolean;
  input: z.ZodType;
}

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  SearchListings: {
    name: 'SearchListings',
    description: 'Search published listings by keyword and marketplace',
    permission: 'public',
    rateLimit: 30,
    audit: true,
    input: z.object({
      query: z.string().trim().min(1).max(200),
      marketplace: z.enum(['gold', 'property', 'vehicles']).optional(),
    }),
  },
  GetListing: {
    name: 'GetListing',
    description: 'Get a listing the user may view',
    permission: 'authenticated',
    rateLimit: 60,
    audit: true,
    input: z.object({ id: z.union([z.string(), z.number()]) }),
  },
  GetOrder: {
    name: 'GetOrder',
    description: 'Get an order owned by the current user',
    permission: 'owner',
    rateLimit: 20,
    audit: true,
    input: z.object({ uuid: z.string().uuid() }),
  },
  GetPayment: {
    name: 'GetPayment',
    description: 'Get a payment intent owned by the current user',
    permission: 'owner',
    rateLimit: 20,
    audit: true,
    input: z.object({ uuid: z.string().uuid() }),
  },
  GetInvoice: {
    name: 'GetInvoice',
    description: 'Get an invoice owned by the current user',
    permission: 'owner',
    rateLimit: 20,
    audit: true,
    input: z.object({ uuid: z.string().uuid() }),
  },
  GetSubscription: {
    name: 'GetSubscription',
    description: 'Get the current user subscription',
    permission: 'authenticated',
    rateLimit: 20,
    audit: true,
    input: z.object({}).optional().default({}),
  },
  SearchGold: {
    name: 'SearchGold',
    description: 'Search gold listings',
    permission: 'public',
    rateLimit: 30,
    audit: true,
    input: z.object({ query: z.string().trim().min(1).max(200) }),
  },
  SearchProperty: {
    name: 'SearchProperty',
    description: 'Search property listings',
    permission: 'public',
    rateLimit: 30,
    audit: true,
    input: z.object({ query: z.string().trim().min(1).max(200) }),
  },
  SearchVehicle: {
    name: 'SearchVehicle',
    description: 'Search vehicle listings',
    permission: 'public',
    rateLimit: 30,
    audit: true,
    input: z.object({ query: z.string().trim().min(1).max(200) }),
  },
  CheckListingStatus: {
    name: 'CheckListingStatus',
    description: 'Check status of a listing the user owns or that is public',
    permission: 'authenticated',
    rateLimit: 30,
    audit: true,
    input: z.object({ id: z.union([z.string(), z.number()]) }),
  },
  CreateSupportTicket: {
    name: 'CreateSupportTicket',
    description: 'Open a human support ticket for the current user',
    permission: 'confirm',
    rateLimit: 5,
    audit: true,
    input: z.object({
      subject: z.string().trim().min(3).max(255),
      description: z.string().trim().max(5000).optional(),
      confirm: z.literal(true),
    }),
  },
  SearchKnowledgeBase: {
    name: 'SearchKnowledgeBase',
    description: 'Search approved public help articles only',
    permission: 'public',
    rateLimit: 30,
    audit: false,
    input: z.object({ query: z.string().trim().min(2).max(200) }),
  },
};

async function searchPublished(query: string, marketplace?: string) {
  const rows = await queryRows<Row>(
    `SELECT l.id, l.uuid, l.title, l.price, l.currency, l.status, m.code AS marketplace
       FROM listings l
       JOIN marketplaces m ON m.id = l.marketplace_id
      WHERE l.deleted_at IS NULL AND l.status = 'published'
        AND (? IS NULL OR m.code = ?)
        AND (l.title LIKE ? OR l.description LIKE ?)
      ORDER BY l.published_at DESC
      LIMIT 8`,
    [marketplace ?? null, marketplace ?? null, `%${query}%`, `%${query}%`],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    title: String(row.title),
    price: row.price === null ? null : Number(row.price),
    currency: row.currency ? String(row.currency) : null,
    marketplace: String(row.marketplace),
  }));
}

export async function executeApprovedTool(params: {
  name: string;
  args: unknown;
  userId: number;
  language: string;
  currency: string;
  confirmed?: boolean;
}): Promise<unknown> {
  const tool = TOOL_REGISTRY[params.name];
  if (!tool) {
    throw new AppError('Unknown AI tool', { status: 400, code: ErrorCode.BAD_REQUEST, expected: true });
  }
  const parsed = tool.input.parse(params.args ?? {});
  if (tool.permission === 'confirm' && params.confirmed !== true && !(parsed as { confirm?: boolean }).confirm) {
    throw new AppError('This action needs your confirmation', { status: 403, code: ErrorCode.FORBIDDEN, expected: true });
  }

  switch (params.name) {
    case 'SearchListings':
      return searchPublished((parsed as { query: string }).query, (parsed as { marketplace?: string }).marketplace);
    case 'SearchGold':
      return searchPublished((parsed as { query: string }).query, 'gold');
    case 'SearchProperty':
      return searchPublished((parsed as { query: string }).query, 'property');
    case 'SearchVehicle':
      return searchPublished((parsed as { query: string }).query, 'vehicles');
    case 'GetListing':
    case 'CheckListingStatus': {
      const listing = await getListing({
        idOrUuid: (parsed as { id: string | number }).id,
        language: params.language,
        currency: params.currency,
        viewerId: params.userId,
        isStaff: false,
      });
      return {
        id: listing.id,
        uuid: listing.uuid,
        title: listing.title,
        status: listing.status,
        lifecycleStatus: listing.lifecycleStatus,
        price: listing.price,
        currency: listing.currency,
      };
    }
    case 'GetOrder': {
      return getOrder((parsed as { uuid: string }).uuid, params.userId, false);
    }
    case 'GetPayment': {
      const row = await queryOne<Row>(
        `SELECT uuid, status, amount, currency, payment_method, created_at
           FROM payment_intents WHERE uuid = ? AND user_id = ?`,
        [(parsed as { uuid: string }).uuid, params.userId],
      );
      if (!row) throw notFound('Payment');
      return row;
    }
    case 'GetInvoice': {
      const row = await queryOne<Row>(
        `SELECT uuid, invoice_number, total_amount, currency, status, pdf_url
           FROM invoices WHERE uuid = ? AND user_id = ?`,
        [(parsed as { uuid: string }).uuid, params.userId],
      );
      if (!row) throw notFound('Invoice');
      return {
        uuid: String(row.uuid),
        invoiceNumber: String(row.invoice_number),
        totalAmount: Number(row.total_amount),
        currency: String(row.currency),
        status: String(row.status),
        pdfUrl: row.pdf_url ? String(row.pdf_url) : null,
      };
    }
    case 'GetSubscription':
      return getCurrentSubscription(params.userId);
    case 'CreateSupportTicket': {
      const input = parsed as { subject: string; description?: string };
      return createTicket(params.userId, { subject: input.subject, description: input.description });
    }
    case 'SearchKnowledgeBase': {
      const { searchKnowledge } = await import('../support/support.kb');
      return searchKnowledge({ q: (parsed as { query: string }).query, perPage: 5, page: 1 });
    }
    default:
      throw forbidden('Tool is not executable');
  }
}

export function inferSupportTools(message: string): Array<{ name: string; args: Record<string, unknown> }> {
  const tools: Array<{ name: string; args: Record<string, unknown> }> = [];
  const order = message.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  if (order && /order|payment|invoice/i.test(message)) {
    if (/invoice/i.test(message)) tools.push({ name: 'GetInvoice', args: { uuid: order[0] } });
    else if (/payment/i.test(message)) tools.push({ name: 'GetPayment', args: { uuid: order[0] } });
    else tools.push({ name: 'GetOrder', args: { uuid: order[0] } });
  }
  if (/subscription|plan|quota/i.test(message)) tools.push({ name: 'GetSubscription', args: {} });
  const listing = message.match(/\b(?:listing|#)\s*(\d+)\b/i);
  if (listing) tools.push({ name: 'CheckListingStatus', args: { id: Number(listing[1]) } });
  return tools.slice(0, 3);
}

export function publicToolCatalog(): Array<{ name: string; description: string; permission: string }> {
  return Object.values(TOOL_REGISTRY).map((tool) => ({
    name: tool.name,
    description: tool.description,
    permission: tool.permission,
  }));
}
