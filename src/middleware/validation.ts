import type { RequestHandler } from 'express';
import type { AnyZodObject, z } from 'zod';

export function validateBody<T extends AnyZodObject>(schema: T): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body) as z.infer<T>;
    next();
  };
}

export function validateQuery<T extends AnyZodObject>(schema: T): RequestHandler {
  return (req, _res, next) => {
    req.query = schema.parse(req.query) as typeof req.query;
    next();
  };
}
