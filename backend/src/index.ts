import "dotenv/config";
import express from "express";
import AdminJSExpress from "@adminjs/express";

import { config } from "./config.js";
import { admin } from "./admin.js";
import { authenticateAdmin } from "./auth.js";
import { healthRouter } from "./routes/health.js";
import { apiRouter } from "./routes/api.js";
import { errorHandler } from "./middleware/error.js";

const app = express();
app.use(express.json());

// AdminJS authenticated router. buildAuthenticatedRouter manages its own
// express-session internally (cookiePassword), so the rest of the app stays
// stateless. Auth is checked against the AdminUser table (bcrypt) in auth.ts.
const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
  admin,
  {
    authenticate: async (email: string, password: string) => authenticateAdmin(email, password),
    cookiePassword: config.ADMIN_SESSION_SECRET,
    cookieName: "bb-admin",
  },
  undefined,
  { secret: config.ADMIN_SESSION_SECRET, resave: false, saveUninitialized: false },
);

app.use(admin.options.rootPath, adminRouter);

// Stateless public surface.
app.use("/health", healthRouter);
app.use("/api", apiRouter);

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log("Bumi & Bloom backend running.");
  console.log(`  Admin:  http://localhost:${config.PORT}${admin.options.rootPath}`);
  console.log(`  Health: http://localhost:${config.PORT}/health`);
  console.log(`  API:    http://localhost:${config.PORT}/api`);
});
