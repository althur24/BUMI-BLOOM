import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = (err as { statusCode?: number })?.statusCode ?? 500;
  // Never leak internal error details in production beyond the message.
  console.error(err);
  res.status(status).json({ error: (err as Error)?.message ?? "Internal Server Error" });
};
