import rateLimit from 'express-rate-limit';

export const publicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
});

export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

export const webhookLimiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false
});
