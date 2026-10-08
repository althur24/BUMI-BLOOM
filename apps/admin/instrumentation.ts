// Next.js instrumentation hook — runs once when the Node server boots.
// Used to start the import worker and recover stranded jobs after a restart.
// Guarded to the nodejs runtime; drainRecovery is safe to no-op if the DB
// is not configured yet.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootWorker } = await import("./lib/queue");
    void bootWorker();
  }
}
