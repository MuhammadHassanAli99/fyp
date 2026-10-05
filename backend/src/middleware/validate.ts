import type { RequestHandler } from 'express';
import { z, type ZodType } from 'zod';
import { validationFailed, type FieldIssue } from '../core/errors';

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

const toIssues = (error: z.ZodError, prefix: string): FieldIssue[] =>
  error.issues.map((issue) => ({
    field: [prefix, ...issue.path.map(String)].filter(Boolean).join('.'),
    message: issue.message,
    code: issue.code,
  }));

/**
 * Validates and *coerces* the request, then exposes the parsed result on
 * `req.valid`. Handlers read `req.valid.body`, never `req.body`, so an unvalidated
 * field can never reach a service.
 *
 * All three parts are validated before responding, so the client sees every
 * problem at once instead of one per round trip.
 */
export const validate =
  (schemas: ValidationSchemas): RequestHandler =>
  (req, _res, next) => {
    const issues: FieldIssue[] = [];

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) req.valid.params = result.data;
      else issues.push(...toIssues(result.error, 'params'));
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) req.valid.query = result.data;
      else issues.push(...toIssues(result.error, 'query'));
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body ?? {});
      if (result.success) req.valid.body = result.data;
      else issues.push(...toIssues(result.error, ''));
    }

    if (issues.length > 0) return next(validationFailed(issues));
    next();
  };

/** Typed accessors so handlers stay free of casts. */
export const body = <T>(req: { valid: { body?: unknown } }): T => req.valid.body as T;
export const query = <T>(req: { valid: { query?: unknown } }): T => req.valid.query as T;
export const params = <T>(req: { valid: { params?: unknown } }): T => req.valid.params as T;
