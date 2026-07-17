import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";

// Single shared PrismaClient. Reused by the Express API, AdminJS resources,
// auth, and storage helpers. Connects via the Supabase POOLER (DATABASE_URL).
export const prisma = new PrismaClient({
  log: config.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
