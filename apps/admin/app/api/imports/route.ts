import { NextResponse } from "next/server";
import { prisma } from "@bumi/db";
import type { ImportSource } from "@prisma/client";
import { requireAdmin, jsonError } from "@/lib/auth";
import { enqueue } from "@/lib/queue";
import { detectPlatform } from "@/lib/platform";
import { canonicalizeUrl } from "@/lib/urls";
import { assertHttpUrl, assertPublicHost } from "@/lib/safe-fetch";

export const dynamic = "force-dynamic";

// POST { url } → enqueue a scrape job. Returns 202 + jobId.
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Body JSON tidak valid");
  }

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const confirmOverwrite = body?.confirmOverwrite === true;
  if (!url) {
    return jsonError(400, "Field `url` wajib dan harus berupa URL http(s).");
  }
  try {
    const parsed = assertHttpUrl(url);
    await assertPublicHost(parsed);
  } catch (e: any) {
    return jsonError(400, e?.message || "URL tidak valid.");
  }

  const platform = detectPlatform(url);
  if (platform === "OTHER") {
    return jsonError(400, "URL tidak didukung.");
  }

  const sourceKey = canonicalizeUrl(url);
  const duplicate = await prisma.importJob.findFirst({
    where: {
      sourceKey,
      status: { in: ["PENDING", "EXTRACTING", "EXTRACTED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (duplicate) {
    return NextResponse.json(
      {
        jobId: duplicate.id,
        status: duplicate.status,
        platform: duplicate.sourceType,
        duplicate: true,
        shopifyAdminUrl: duplicate.shopifyAdminUrl,
        message:
          duplicate.status === "PUSHED"
            ? "Produk ini sudah pernah diimpor dan sudah ada di Shopify."
            : "Produk ini sedang/dalam antrean import.",
      },
      { status: 200 },
    );
  }

  // Re-importing a product that already exists in Shopify updates it in place.
  // Carry the previous Shopify id/handle so the push can find it even if the
  // title (and therefore the slug) changed.
  const previous = await prisma.importJob.findFirst({
    where: { sourceKey, status: "PUSHED", shopifyProductId: { not: null } },
    orderBy: { createdAt: "desc" },
  });

  // Manual edits made from the Produk page must not be silently overwritten by
  // a re-import — require an explicit confirmation from the admin.
  if (previous?.manuallyEditedAt && !confirmOverwrite) {
    return NextResponse.json(
      {
        requiresConfirmation: true,
        manuallyEditedAt: previous.manuallyEditedAt,
        shopifyAdminUrl: previous.shopifyAdminUrl,
        message:
          "Produk ini pernah diedit manual dari halaman Produk. Import ulang akan menimpa perubahan tersebut.",
      },
      { status: 409 },
    );
  }

  const job = await prisma.importJob.create({
    data: {
      sourceUrl: url,
      sourceKey,
      sourceType: platform as ImportSource,
      status: "PENDING",
      shopifyProductId: previous?.shopifyProductId ?? null,
      shopifyHandle: previous?.shopifyHandle ?? null,
      createdBy: ctx.email,
    },
  });
  void enqueue(job.id);

  return NextResponse.json(
    { jobId: job.id, status: "PENDING", platform },
    { status: 202 },
  );
}

// GET → list recent import jobs (newest first), paginated.
export async function GET(request: Request) {
  try {
    await requireAdmin();
  } catch (e: any) {
    return jsonError(e.status || 500, e.message);
  }

  const u = new URL(request.url);
  const page = Math.max(1, Number(u.searchParams.get("page")) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, Number(u.searchParams.get("pageSize")) || 20),
  );

  try {
    const [jobs, total] = await Promise.all([
      prisma.importJob.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.importJob.count(),
    ]);

    return NextResponse.json({ jobs, page, pageSize, total });
  } catch (e: any) {
    // Surface the real DB/Prisma error instead of a generic 500.
    return jsonError(500, `${e?.name || "Error"}: ${e?.message || String(e)}`);
  }
}
