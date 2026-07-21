import type { ErrorRequestHandler } from "express";
import { config } from "../config.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = (err as { statusCode?: number })?.statusCode ?? 500;
  console.error(err);
  // Client errors (4xx) may surface their message; 5xx details (Prisma/SQL)
  // stay server-side in production.
  const message =
    status < 500 || config.NODE_ENV !== "production"
      ? ((err as Error)?.message ?? "Internal Server Error")
      : "Internal Server Error";
  res.status(status).json({ error: message });
};
