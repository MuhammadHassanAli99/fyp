import { insertAndGetId } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { badRequest } from '../../core/errors';
import { roundDecimal } from '../../core/decimal';

export async function estimateFinance(params: {
  listingId?: number | null;
  userId?: number | null;
  vehiclePrice: number;
  downPayment: number;
  termMonths: number;
  annualRatePct: number;
  currency: string;
}) {
  if (params.vehiclePrice <= 0) throw badRequest('Vehicle price must be positive');
  if (params.downPayment < 0 || params.downPayment >= params.vehiclePrice) {
    throw badRequest('Down payment must be less than the vehicle price');
  }
  if (params.termMonths < 1 || params.termMonths > 120) throw badRequest('Term must be between 1 and 120 months');
  const loan = params.vehiclePrice - params.downPayment;
  const monthlyRate = params.annualRatePct / 100 / 12;
  const estimatedMonthly =
    monthlyRate === 0
      ? loan / params.termMonths
      : (loan * monthlyRate) / (1 - (1 + monthlyRate) ** -params.termMonths);
  const monthly = Number(roundDecimal(estimatedMonthly, 2));
  const disclaimer =
    'This is an estimated monthly payment, not a lender offer. Actual terms depend on credit approval and local regulation.';
  const id = await insertAndGetId(
    `INSERT INTO vehicle_financing_quotes
       (uuid, listing_id, user_id, vehicle_price, down_payment, loan_amount, term_months, annual_rate_pct,
        estimated_monthly, currency, is_estimate, disclaimer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      uuid(),
      params.listingId ?? null,
      params.userId ?? null,
      roundDecimal(params.vehiclePrice, 2),
      roundDecimal(params.downPayment, 2),
      roundDecimal(loan, 2),
      params.termMonths,
      params.annualRatePct,
      monthly,
      params.currency,
      disclaimer,
    ],
  );
  return {
    id,
    vehiclePrice: params.vehiclePrice,
    downPayment: params.downPayment,
    loanAmount: loan,
    termMonths: params.termMonths,
    annualRatePct: params.annualRatePct,
    estimatedMonthly: monthly,
    currency: params.currency,
    isEstimate: true,
    disclaimer,
  };
}

export async function estimateInsurance(params: {
  listingId?: number | null;
  userId?: number | null;
  coverage?: string;
  currency: string;
  vehiclePrice: number;
}) {
  const premium = Number(roundDecimal(params.vehiclePrice * 0.03, 2));
  const disclaimer =
    'This is a stub insurance quote for integration testing. It is not a bindable policy and collects no extra personal data.';
  const id = await insertAndGetId(
    `INSERT INTO vehicle_insurance_quotes
       (uuid, listing_id, user_id, provider_code, coverage, premium, currency, is_estimate, disclaimer)
     VALUES (?, ?, ?, 'stub', ?, ?, ?, 1, ?)`,
    [
      uuid(),
      params.listingId ?? null,
      params.userId ?? null,
      params.coverage ?? 'comprehensive_estimate',
      premium,
      params.currency,
      disclaimer,
    ],
  );
  return {
    id,
    providerCode: 'stub',
    coverage: params.coverage ?? 'comprehensive_estimate',
    premium,
    currency: params.currency,
    isEstimate: true,
    disclaimer,
  };
}
