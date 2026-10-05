import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/async-handler';
import { created, ok, accepted, withCache } from '../../core/http/response';
import { validate, body, query, params } from '../../middleware/validate';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { aiRateLimit, writeRateLimit } from '../../middleware/rate-limit';
import { riskGuard } from '../../middleware/risk-guard';
import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import {
  getGoldPredictions,
  getGoldRateHistory,
  getGoldRates,
  getPurityStandards,
  quoteGold,
} from './gold.service';
import { getGoldCatalog, listHallmarkAuthorities } from './gold.catalog';
import { listBrands } from '../../modules/catalog/catalog.service';
import { assessAuthenticityRisk } from './gold.ai';
import { throughGateway } from '../../modules/ai/ai.gateway';
import { buyGoldListing, confirmGoldDelivery } from './gold.commerce';
import { createVerificationRequest, getVerificationRequest, listVerificationRequests, recordVerificationResult } from './gold.verification';
import { getComplianceRule } from './gold.compliance';
import { getAuction, getAuctionByListing, listBids, placeBid } from '../../modules/auctions/auctions.service';

export const goldRouter = Router();

goldRouter.get(
  '/catalog',
  asyncHandler(async (req, res) => {
    withCache(res, 300);
    return ok(res, await getGoldCatalog({ countryId: req.context.countryId, language: req.context.language }));
  }),
);

goldRouter.get(
  '/brands',
  asyncHandler(async (_req, res) => {
    withCache(res, 600);
    return ok(res, await listBrands(1));
  }),
);

goldRouter.get(
  '/hallmark-authorities',
  asyncHandler(async (req, res) => {
    withCache(res, 600);
    return ok(res, await listHallmarkAuthorities(req.context.countryId));
  }),
);

goldRouter.get(
  '/compliance',
  asyncHandler(async (req, res) => {
    const rule = await getComplianceRule(req.context.countryId);
    withCache(res, 300);
    return ok(res, {
      rule,
      note: 'Compliance thresholds are configurable per country. They are not legal advice.',
    });
  }),
);

goldRouter.get(
  '/rates',
  validate({
    query: z.object({
      metal: z.enum(['gold', 'silver', 'platinum', 'palladium']).default('gold'),
      cityId: z.coerce.number().int().positive().optional(),
      karat: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ metal: string; cityId?: number; karat?: string }>(req);
    const karats = q.karat
      ? q.karat
          .split(',')
          .map((value) => Number(value.replace(/k$/i, '')))
          .filter(Number.isFinite)
      : undefined;

    const rates = await getGoldRates({
      countryId: req.context.countryId,
      cityId: q.cityId ?? null,
      currency: req.context.currency,
      metal: q.metal,
      karats,
    });

    withCache(res, 60);
    return ok(res, {
      rates,
      currency: req.context.currency,
      countryCode: req.context.countryCode,
      disclaimer: 'Live rates are a market reference. They do not replace the seller listing price.',
    });
  }),
);

goldRouter.get(
  '/rates/history',
  validate({
    query: z.object({
      karat: z.coerce.number().min(1).max(24).default(24),
      days: z.coerce.number().int().min(7).max(365).default(30),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ karat: number; days: number }>(req);
    const history = await getGoldRateHistory({
      countryId: req.context.countryId,
      currency: req.context.currency,
      karat: q.karat,
      days: q.days,
    });
    withCache(res, 300);
    return ok(res, { karat: q.karat, currency: req.context.currency, points: history });
  }),
);

goldRouter.get(
  '/rates/forecast',
  validate({ query: z.object({ karat: z.coerce.number().min(1).max(24).default(24) }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ karat: number }>(req);
    const predictions = await getGoldPredictions({
      countryId: req.context.countryId,
      currency: req.context.currency,
      karat: q.karat,
    });
    withCache(res, 900);
    return ok(res, {
      karat: q.karat,
      currency: req.context.currency,
      predictions,
      disclaimer: 'Forecasts are estimated ranges with a model version, not guaranteed future prices.',
    });
  }),
);

goldRouter.get(
  '/purity-standards',
  asyncHandler(async (req, res) => {
    const [standards, catalog] = await Promise.all([
      getPurityStandards(),
      getGoldCatalog({ countryId: req.context.countryId, language: req.context.language }),
    ]);
    withCache(res, 3600);
    return ok(res, { standards, countryStandards: catalog.countryPurities });
  }),
);

goldRouter.post(
  '/quote',
  validate({
    body: z.object({
      karat: z.coerce.number().min(1).max(24),
      weight: z.coerce.number().positive().max(1_000_000),
      weightUnit: z.enum(['gram', 'tola', 'ounce', 'kg']).default('gram'),
      stoneWeightG: z.coerce.number().min(0).optional(),
      makingCharges: z.coerce.number().min(0).optional(),
      makingChargeType: z.enum(['flat', 'per_gram', 'percent', 'FIXED', 'PER_GRAM', 'PERCENTAGE']).optional(),
      wastagePercent: z.coerce.number().min(0).max(100).optional(),
      stoneCharges: z.coerce.number().min(0).optional(),
      taxPercent: z.coerce.number().min(0).max(100).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      karat: number;
      weight: number;
      weightUnit: 'gram' | 'tola' | 'ounce' | 'kg';
      stoneWeightG?: number;
      makingCharges?: number;
      makingChargeType?: string;
      wastagePercent?: number;
      stoneCharges?: number;
      taxPercent?: number;
    }>(req);
    const type = input.makingChargeType?.toLowerCase();
    const quote = await quoteGold({
      karat: input.karat,
      weight: input.weight,
      weightUnit: input.weightUnit,
      stoneWeightG: input.stoneWeightG,
      makingCharges: input.makingCharges,
      makingChargeType: type === 'fixed' ? 'flat' : type === 'percentage' ? 'percent' : (type as 'flat' | 'per_gram' | 'percent' | undefined),
      wastagePercent: input.wastagePercent,
      stoneCharges: input.stoneCharges,
      taxPercent: input.taxPercent,
      countryId: req.context.countryId,
      currency: req.context.currency,
    });
    return ok(res, {
      ...quote,
      disclaimer: 'This is a reference estimate. The seller listing price remains a separate value.',
    });
  }),
);

goldRouter.post(
  '/authenticity-check',
  requireAuth,
  aiRateLimit,
  validate({
    body: z.object({
      listingId: z.coerce.number().int().positive().optional(),
      declaredKarat: z.coerce.number().min(1).max(24),
      declaredWeightG: z.coerce.number().positive().max(1_000_000),
      measuredVolumeMl: z.coerce.number().positive().max(100_000).optional(),
      isHallmarked: z.coerce.boolean().default(false),
      hallmarkCode: z.string().trim().max(64).optional(),
      hasCertificate: z.coerce.boolean().default(false),
      certificateNumber: z.string().trim().max(96).optional(),
      price: z.coerce.number().min(0).optional(),
      mediaId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<{
      listingId?: number;
      declaredKarat: number;
      declaredWeightG: number;
      measuredVolumeMl?: number;
      isHallmarked: boolean;
      hallmarkCode?: string;
      hasCertificate: boolean;
      certificateNumber?: string;
      price?: number;
      mediaId?: number;
    }>(req);

    const gated = await throughGateway(req, {
      task: 'review_authenticity',
      entityType: input.listingId ? 'listing' : null,
      entityId: input.listingId ?? null,
      input,
      run: async () => {
        const assessment = await assessAuthenticityRisk({
          listingId: input.listingId ?? null,
          userId: req.auth?.userId ?? null,
          declaredKarat: input.declaredKarat,
          declaredWeightG: input.declaredWeightG,
          measuredVolumeMl: input.measuredVolumeMl ?? null,
          isHallmarked: input.isHallmarked,
          hallmarkCode: input.hallmarkCode ?? null,
          hasCertificate: input.hasCertificate,
          certificateNumber: input.certificateNumber ?? null,
          price: input.price ?? null,
          currency: req.context.currency,
          countryId: req.context.countryId,
          mediaId: input.mediaId ?? null,
        });
        return {
          ...assessment,
          model: assessment.model.id,
          confidence: assessment.confidence,
          latencyMs: 0,
        };
      },
    });
    if ('accepted' in gated) return accepted(res, gated);
    return ok(res, { ...gated.result, meta: gated.meta });
  }),
);

goldRouter.post(
  '/listings/:id/assess',
  authenticate,
  requireAuth,
  aiRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const listing = await queryOne<Row>(
      `SELECT l.id, l.user_id, l.price, l.currency, gd.karat, gd.net_weight_g, gd.is_hallmarked,
              gd.hallmark_code, gd.has_certificate, gd.certificate_number
         FROM listings l JOIN gold_listing_details gd ON gd.listing_id = l.id
        WHERE l.id = ?`,
      [id],
    );
    if (!listing) throw notFound('Gold listing');
    const gated = await throughGateway(req, {
      task: 'review_authenticity',
      entityType: 'listing',
      entityId: id,
      input: { listingId: id },
      run: async () => {
        const assessment = await assessAuthenticityRisk({
          listingId: id,
          userId: Number(listing.user_id),
          declaredKarat: Number(listing.karat ?? 22),
          declaredWeightG: Number(listing.net_weight_g ?? 0) || 0.001,
          isHallmarked: Number(listing.is_hallmarked) === 1,
          hallmarkCode: (listing.hallmark_code as string | null) ?? null,
          hasCertificate: Number(listing.has_certificate) === 1,
          certificateNumber: (listing.certificate_number as string | null) ?? null,
          price: listing.price === null ? null : Number(listing.price),
          currency: (listing.currency as string | null) ?? req.context.currency,
          countryId: req.context.countryId,
        });
        return { ...assessment, model: assessment.model.id, confidence: assessment.confidence, latencyMs: 0 };
      },
    });
    if ('accepted' in gated) return accepted(res, gated);
    return ok(res, { ...gated.result, meta: gated.meta });
  }),
);

goldRouter.post(
  '/listings/:id/buy',
  authenticate,
  requireAuth,
  writeRateLimit,
  riskGuard('enforce'),
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      gatewayCode: z.string().min(1).max(32).default('manual'),
      quantity: z.coerce.number().int().min(1).max(100).default(1),
      returnUrl: z.string().url().max(512).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{ gatewayCode: string; quantity: number; returnUrl?: string }>(req);
    return created(
      res,
      await buyGoldListing({
        listingId: id,
        buyerId: req.auth!.userId,
        countryId: req.context.countryId ?? 1,
        gatewayCode: input.gatewayCode,
        quantity: input.quantity,
        returnUrl: input.returnUrl ?? null,
      }),
    );
  }),
);

goldRouter.post(
  '/orders/:id/confirm-delivery',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await confirmGoldDelivery({ orderId: id, userId: req.auth!.userId }));
  }),
);

goldRouter.get(
  '/listings/:id/auction',
  authenticate,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const auction = await getAuctionByListing(id);
    if (!auction) throw notFound('Auction');
    const bids = await listBids(auction.id, 30);
    return ok(res, { auction, bids });
  }),
);

goldRouter.post(
  '/auctions/:id/bids',
  authenticate,
  requireAuth,
  writeRateLimit,
  riskGuard('enforce'),
  validate({
    params: z.object({ id: z.string().min(1).max(64) }),
    body: z.object({
      amount: z.coerce.number().positive().max(1_000_000_000_000),
      idempotencyKey: z.string().min(8).max(64).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const input = body<{ amount: number; idempotencyKey?: string }>(req);
    const auction = await getAuction(id);
    return ok(
      res,
      await placeBid({
        auctionId: auction.id,
        bidderId: req.auth!.userId,
        amount: input.amount,
        idempotencyKey: input.idempotencyKey ?? null,
        req,
      }),
    );
  }),
);

goldRouter.post(
  '/listings/:id/certificates',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      certificateNumber: z.string().trim().min(1).max(96),
      issuer: z.string().trim().min(1).max(128),
      issuerCode: z.string().trim().max(48).optional(),
      issueDate: z.string().optional(),
      expiryDate: z.string().optional(),
      declaredKarat: z.coerce.number().min(1).max(24).optional(),
      declaredFineness: z.coerce.number().int().min(1).max(1000).optional(),
      declaredWeightG: z.coerce.number().positive().optional(),
      documentId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    await assertListingOwner(id, req.auth!.userId, req.auth!.isStaff);
    const input = body<{
      certificateNumber: string;
      issuer: string;
      issuerCode?: string;
      issueDate?: string;
      expiryDate?: string;
      declaredKarat?: number;
      declaredFineness?: number;
      declaredWeightG?: number;
      documentId?: number;
    }>(req);

    if (input.documentId) {
      await execute(`UPDATE listing_documents SET is_public = 0 WHERE id = ? AND listing_id = ?`, [input.documentId, id]);
    }

    const certId = await insertAndGetId(
      `INSERT INTO gold_certificates
         (listing_id, certificate_number, issuer, issuer_code, issue_date, expiry_date,
          declared_karat, declared_fineness, declared_weight_g, document_id, verification_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unverified', ?)`,
      [
        id,
        input.certificateNumber,
        input.issuer,
        input.issuerCode ?? null,
        input.issueDate ?? null,
        input.expiryDate ?? null,
        input.declaredKarat ?? null,
        input.declaredFineness ?? null,
        input.declaredWeightG ?? null,
        input.documentId ?? null,
        req.auth!.userId,
      ],
    );

    await execute(
      `UPDATE gold_listing_details
          SET has_certificate = 1, certificate_number = ?, certificate_id = ?
        WHERE listing_id = ?`,
      [input.certificateNumber, certId, id],
    );

    await recordAudit({
      action: 'gold.certificate.uploaded',
      entityType: 'gold_certificate',
      entityId: certId,
      after: { listingId: id, issuer: input.issuer },
    });

    return created(res, { id: certId, verificationStatus: 'unverified', hasDocument: Boolean(input.documentId) });
  }),
);

goldRouter.get(
  '/listings/:id/certificates',
  authenticate,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const rows = await queryRows<Row>(
      `SELECT id, certificate_number, issuer, issuer_code, issue_date, expiry_date,
              declared_karat, declared_fineness, declared_weight_g, verification_status, verified_at,
              document_id
         FROM gold_certificates WHERE listing_id = ? AND deleted_at IS NULL`,
      [id],
    );
    const owner = await isListingOwnerOrStaff(id, req.auth?.userId ?? null, req.auth?.isStaff ?? false);
    return ok(
      res,
      rows.map((row) => ({
        id: Number(row.id),
        certificateNumber: String(row.certificate_number),
        issuer: String(row.issuer),
        issuerCode: (row.issuer_code as string | null) ?? null,
        issueDate: row.issue_date ? String(row.issue_date).slice(0, 10) : null,
        expiryDate: row.expiry_date ? String(row.expiry_date).slice(0, 10) : null,
        declaredKarat: row.declared_karat === null ? null : Number(row.declared_karat),
        declaredFineness: row.declared_fineness === null ? null : Number(row.declared_fineness),
        declaredWeightG: row.declared_weight_g === null ? null : Number(row.declared_weight_g),
        verificationStatus: String(row.verification_status),
        verifiedAt: row.verified_at ? (row.verified_at as Date).toISOString() : null,
        hasDocument: row.document_id !== null,
        documentId: owner && row.document_id !== null ? Number(row.document_id) : null,
      })),
    );
  }),
);

goldRouter.post(
  '/listings/:id/hallmarks',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      hallmarkCode: z.string().trim().min(1).max(64),
      authorityId: z.coerce.number().int().positive().optional(),
      authorityName: z.string().trim().max(128).optional(),
      countryId: z.coerce.number().int().positive().optional(),
      purityKarat: z.coerce.number().min(1).max(24).optional(),
      fineness: z.coerce.number().int().min(1).max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    await assertListingOwner(id, req.auth!.userId, req.auth!.isStaff);
    const input = body<{
      hallmarkCode: string;
      authorityId?: number;
      authorityName?: string;
      countryId?: number;
      purityKarat?: number;
      fineness?: number;
    }>(req);
    const hallmarkId = await insertAndGetId(
      `INSERT INTO gold_hallmarks
         (listing_id, authority_id, authority_name, country_id, hallmark_code, purity_karat, fineness, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'unverified')`,
      [
        id,
        input.authorityId ?? null,
        input.authorityName ?? null,
        input.countryId ?? req.context.countryId,
        input.hallmarkCode,
        input.purityKarat ?? null,
        input.fineness ?? null,
      ],
    );
    await execute(
      `UPDATE gold_listing_details
          SET is_hallmarked = 1, hallmark_code = ?, hallmark_id = ?
        WHERE listing_id = ?`,
      [input.hallmarkCode, hallmarkId, id],
    );
    await recordAudit({
      action: 'gold.hallmark.recorded',
      entityType: 'gold_hallmark',
      entityId: hallmarkId,
      after: { listingId: id },
    });
    return created(res, { id: hallmarkId, verificationStatus: 'unverified' });
  }),
);

goldRouter.post(
  '/listings/:id/verification-requests',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      method: z.enum(['laboratory', 'authorized_dealer', 'physical_inspection', 'xrf', 'hallmark', 'certificate']),
      providerName: z.string().trim().max(128).optional(),
      orderId: z.coerce.number().int().positive().optional(),
      notes: z.string().trim().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{
      method: 'laboratory' | 'authorized_dealer' | 'physical_inspection' | 'xrf' | 'hallmark' | 'certificate';
      providerName?: string;
      orderId?: number;
      notes?: string;
    }>(req);
    return created(
      res,
      await createVerificationRequest({
        listingId: id,
        userId: req.auth!.userId,
        method: input.method,
        providerName: input.providerName ?? null,
        orderId: input.orderId ?? null,
        notes: input.notes ?? null,
      }),
    );
  }),
);

goldRouter.get(
  '/listings/:id/verification-requests',
  authenticate,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    return ok(res, await listVerificationRequests(id));
  }),
);

goldRouter.get(
  '/verification-requests/:id',
  authenticate,
  requireAuth,
  validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => ok(res, await getVerificationRequest(params<{ id: number }>(req).id))),
);

goldRouter.post(
  '/verification-requests/:id/results',
  authenticate,
  requireAuth,
  writeRateLimit,
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({
      outcome: z.enum(['pass', 'fail', 'inconclusive']),
      measuredKarat: z.coerce.number().min(1).max(24).optional(),
      measuredFineness: z.coerce.number().int().min(1).max(1000).optional(),
      measuredWeightG: z.coerce.number().positive().optional(),
      methodDetail: z.string().max(128).optional(),
      performedBy: z.string().max(128).optional(),
      notes: z.string().max(500).optional(),
      reportDocumentId: z.coerce.number().int().positive().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { id } = params<{ id: number }>(req);
    const input = body<{
      outcome: 'pass' | 'fail' | 'inconclusive';
      measuredKarat?: number;
      measuredFineness?: number;
      measuredWeightG?: number;
      methodDetail?: string;
      performedBy?: string;
      notes?: string;
      reportDocumentId?: number;
    }>(req);
    return ok(
      res,
      await recordVerificationResult({
        requestId: id,
        actorId: req.auth!.userId,
        isStaff: req.auth!.isStaff,
        ...input,
      }),
    );
  }),
);

async function assertListingOwner(listingId: number, userId: number, isStaff: boolean): Promise<void> {
  const okOwner = await isListingOwnerOrStaff(listingId, userId, isStaff);
  if (!okOwner) throw forbidden('You can only manage certificates on your own listings');
}

async function isListingOwnerOrStaff(listingId: number, userId: number | null, isStaff: boolean): Promise<boolean> {
  if (isStaff) return true;
  if (!userId) return false;
  const row = await queryOne<Row>('SELECT user_id FROM listings WHERE id = ? AND deleted_at IS NULL', [listingId]);
  if (!row) throw notFound('Listing');
  return Number(row.user_id) === userId;
}
