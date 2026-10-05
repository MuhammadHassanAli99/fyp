import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 5 forwards rejected promises to the error middleware, but only for
 * handlers it recognises as async. Wrapping keeps that guarantee explicit and
 * survives refactors from async to sync and back.
 */
export const asyncHandler =
  <Req extends Request = Request>(handler: (req: Req, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(handler(req as Req, res, next)).catch(next);
  };
