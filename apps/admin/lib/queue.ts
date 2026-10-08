// Import worker — env-gated backend:
//   - REDIS_URL set  → BullMQ queue + worker (retry/concurrency, survives
//                      restarts via Redis persistence).
//   - no REDIS_URL    → in-process FIFO + DB-backed recovery (default, dev).
// Both share `processJob` (PENDING → EXTRACTING → EXTRACTED | FAILED) and the
// same recovery logic (reset stuck EXTRACTING/PUSHING, re-enqueue PENDING).
//
// BullMQ is dynamically imported so the route handler (which imports `enqueue`)
// never pulls `bullmq` into its bundle unless Redis is actually configured.

import { prisma } from "@bumi/db";
import type { ImportSource, ImportStatus } from "@prisma/client";
import { rehostImages } from "./storage";
import { enrichProduct } from "./ai/enrich";

const useBullMQ = (): boolean => Boolean(process.env.REDIS_URL);

// ── Shared processor ───────────────────────────────────────────────────────
async function processJob(jobId: string): Promise<void> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.status !== "PENDING" && job.status !== "EXTRACTING") return;

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "EXTRACTING" as ImportStatus },
  });

  try {
    // Lazy import so route handlers don't pull Playwright at module load.
    const { scrape } = await import("./scrapers");
    const result = await scrape(job.sourceUrl);

    if (!result.ok || !result.normalized) {
      await failJob(jobId, result.error || "Unknown scrape error", result.raw);
      return;
    }

    const np = result.normalized;

    // Re-host images to Supabase Storage (fallback to originals if not configured).
    let images = np.images;
    try {
      const rehosted = await rehostImages(np.images);
      if (rehosted.length) images = rehosted;
    } catch {
      // keep original URLs
    }

    // Enrich: rule-based cleaning (always) + AI layer if OPENAI_API_KEY is set.
    const { enriched, aiUsed, aiMeta } = await enrichProduct({ ...np, images });

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "EXTRACTED" as ImportStatus,
        rawJson: (result.raw ?? null) as any,
        extractedJson: enriched as any,
        aiJson: { aiUsed, ...(aiMeta || {}) } as any,
      },
    });
  } catch (e) {
    // Unexpected throw — mark FAILED so the job never strands in EXTRACTING.
    await failJob(jobId, errMsg(e)).catch(() => {});
  }
}

async function failJob(
  jobId: string,
  error: string,
  raw?: unknown,
): Promise<void> {
  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED" as ImportStatus,
      errorMessage: error,
      rawJson: (raw ?? null) as any,
    },
  });
}

// ── Shared recovery ────────────────────────────────────────────────────────
// Resets stuck jobs and returns PENDING ids to re-enqueue. pushProductToShopify
// is idempotent (delete + recreate by handle), so re-pushing after a PUSHING
// crash is safe.
async function recoverStuckAndListPending(): Promise<string[]> {
  await prisma.importJob.updateMany({
    where: { status: "PUSHING" as ImportStatus },
    data: { status: "EXTRACTED" as ImportStatus },
  });
  await prisma.importJob.updateMany({
    where: { status: "EXTRACTING" as ImportStatus },
    data: { status: "PENDING" as ImportStatus },
  });
  const pending = await prisma.importJob.findMany({
    where: { status: "PENDING" as ImportStatus },
    select: { id: true },
  });
  return pending.map((p) => p.id);
}

// ── In-process backend (default) ────────────────────────────────────────────
const inprocQueue: string[] = [];
let processing = false;

function enqueueInproc(jobId: string): void {
  inprocQueue.push(jobId);
  void runInprocWorker();
}

async function runInprocWorker(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (inprocQueue.length) {
      const jobId = inprocQueue.shift() as string;
      await processJob(jobId).catch((e) =>
        console.error(`[queue] processJob ${jobId} error:`, errMsg(e)),
      );
    }
  } finally {
    processing = false;
  }
}

// ── BullMQ backend (REDIS_URL) ──────────────────────────────────────────────
let bullmqQueue: any = null;
let bullmqWorkerStarted = false;

async function getBullmqQueue(): Promise<any> {
  if (bullmqQueue) return bullmqQueue;
  const { Queue } = await import("bullmq");
  bullmqQueue = new Queue("imports", {
    connection: { url: process.env.REDIS_URL },
  });
  return bullmqQueue;
}

async function startBullmqWorker(): Promise<void> {
  if (bullmqWorkerStarted) return;
  bullmqWorkerStarted = true;
  const { Worker } = await import("bullmq");
  const worker = new Worker(
    "imports",
    async (job: any) => {
      const jobId = job?.data?.jobId;
      if (jobId)
        await processJob(jobId).catch((e) =>
          console.error(`[bullmq] processJob ${jobId}:`, errMsg(e)),
        );
    },
    { connection: { url: process.env.REDIS_URL }, concurrency: 1 },
  );
  worker.on("failed", (job: any, err: Error) =>
    console.error(`[bullmq] job ${job?.id} failed:`, err.message),
  );
}

// ── Public API ─────────────────────────────────────────────────────────────
export async function enqueue(jobId: string): Promise<void> {
  if (useBullMQ()) {
    const q = await getBullmqQueue();
    await q.add("import", { jobId });
  } else {
    enqueueInproc(jobId);
  }
}

let booted = false;
export async function bootWorker(): Promise<void> {
  if (booted) return;
  booted = true;

  if (useBullMQ()) {
    try {
      await startBullmqWorker();
      const ids = await recoverStuckAndListPending();
      for (const id of ids) await enqueue(id);
      if (ids.length)
        console.log(`[queue] recovered ${ids.length} pending job(s) via BullMQ`);
    } catch (e) {
      // BullMQ unavailable — fall back to in-process so the app still works.
      console.error("[queue] BullMQ boot failed, falling back:", errMsg(e));
      const ids = await recoverStuckAndListPending().catch(() => [] as string[]);
      for (const id of ids) enqueueInproc(id);
    }
    return;
  }

  try {
    const ids = await recoverStuckAndListPending();
    for (const id of ids) enqueueInproc(id);
    if (ids.length)
      console.log(`[queue] recovered ${ids.length} pending job(s)`);
  } catch (e) {
    // DB not configured yet (placeholder env) — no-op.
    console.error("[queue] drainRecovery skipped:", errMsg(e));
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type { ImportSource, ImportStatus };
