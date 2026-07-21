import "dotenv/config";
import express from "express";

import { config } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { apiRouter } from "./routes/api.js";
import { errorHandler } from "./middleware/error.js";

const app = express();
app.use(express.json());

// Stateless public surface.
app.use("/health", healthRouter);
app.use("/api", apiRouter);

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log("Bumi & Bloom backend running.");
  console.log(`  Health: http://localhost:${config.PORT}/health`);
  console.log(`  API:    http://localhost:${config.PORT}/api`);
});
