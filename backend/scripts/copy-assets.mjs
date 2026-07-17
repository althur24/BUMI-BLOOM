// tsc only compiles .ts, so the AdminJS .jsx component under src/admin/components
// isn't emitted to dist/. Copy it across so the production build (node dist/index.js)
// can resolve the custom upload component.
import { cpSync } from "node:fs";

cpSync("src/admin/components", "dist/admin/components", { recursive: true });
console.log("Copied admin components → dist/admin/components");
