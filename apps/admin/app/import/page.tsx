"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { NormalizedColor, NormalizedProduct, ScraperVariant } from "@/lib/scrapers/base";
import {
  addColorToVariants,
  colorOptionOf,
  colorsFromVariants,
  hexForColorName,
  normalizeColorName,
  normalizeHex,
} from "@/lib/colors";

interface ImportJob {
  id: string;
  sourceUrl: string;
  sourceType: string;
  status: string;
  extractedJson: NormalizedProduct | null;
  shopifyAdminUrl: string | null;
  shopifyHandle: string | null;
  errorMessage: string | null;
  createdAt: string;
  rawJson?: any;
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: "badge--yellow",
  EXTRACTING: "badge--yellow",
  EXTRACTED: "badge--dark",
  PUSHING: "badge--yellow",
  PUSHED: "badge--green",
  FAILED: "badge--coral",
};

const POLL_TIMEOUT_MS = 90_000;

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error("NO_SESSION");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function fmtAud(n: number | undefined): string {
  if (n == null) return "-";
  return `$${n.toFixed(2)} AUD`;
}

// Colour palette for the preview/push. Variant Color options are the source of
// truth; scraper/AI/admin colors only supply hex (dictionary as last resort).
// This guarantees every swatch the admin sees can actually be checked out.
function buildColors(
  np: NormalizedProduct | null,
  variants?: ScraperVariant[],
): NormalizedColor[] {
  if (!np) return [];
  return colorsFromVariants(variants ?? np.variants ?? [], np.colors || []);
}

export default function ImportPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<ImportJob | null>(null);
  const [edits, setEdits] = useState<Partial<NormalizedProduct>>({});
  const [history, setHistory] = useState<ImportJob[]>([]);
  const [pushResult, setPushResult] = useState<{ shopifyAdminUrl?: string; warnings?: string[] } | null>(null);
  const [error, setError] = useState("");
  const [confirmPush, setConfirmPush] = useState(false);
  const [removedImageIdx, setRemovedImageIdx] = useState<Set<number>>(new Set());
  const [primaryImageIdx, setPrimaryImageIdx] = useState(0);
  const [variantStockEdits, setVariantStockEdits] = useState<Record<number, number>>({});
  const [removedVariants, setRemovedVariants] = useState<Set<number>>(new Set());
  const [newColorName, setNewColorName] = useState("");
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [newColorHex, setNewColorHex] = useState("#CCCCCC");
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) { router.replace("/login"); return; }
      setReady(true);
      refreshHistory().catch(() => {});
    })();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const r = await api("/api/imports?pageSize=20");
      setHistory(r.jobs || []);
    } catch (e: any) {
      if (e.message === "NO_SESSION") router.replace("/login");
    }
  }, [router]);

  const pollJob = useCallback((jobId: string) => {
    if (pollRef.current) clearTimeout(pollRef.current);
    startTimeRef.current = Date.now();
    setElapsed(0);
    const tick = async () => {
      const el = Math.round((Date.now() - startTimeRef.current) / 1000);
      setElapsed(el);
      if (el > POLL_TIMEOUT_MS / 1000) {
        setError("Timeout — proses ekstrak terlalu lama. Coba lagi.");
        setBusy(false);
        return;
      }
      try {
        const r = await api(`/api/imports/${jobId}`);
        const job = r.job as ImportJob;
        setActive(job);
        if (job.status === "EXTRACTED" || job.status === "FAILED") {
          if (job.extractedJson) {
            setEdits({});
            setRemovedImageIdx(new Set());
            setPrimaryImageIdx(0);
            setVariantStockEdits({});
            setRemovedVariants(new Set());
            setNewColorName("");
            setNewColorHex("#CCCCCC");
          }
          return;
        }
        pollRef.current = setTimeout(tick, 2000);
      } catch (e: any) {
        if (e.message === "NO_SESSION") router.replace("/login");
        else setError(e.message);
      }
    };
    tick();
  }, [router]);

  async function onExtract(e: React.FormEvent) {
    e.preventDefault();
    const url = urlInput.trim();
    if (!url) return;
    setError(""); setPushResult(null); setActive(null);
    setConfirmPush(false); setBusy(true);
    try {
      const r = await api("/api/imports", "POST", { url });
      if (r.duplicate) {
        setActive({
          id: r.jobId, sourceUrl: url, sourceType: r.platform, status: r.status,
          extractedJson: null, shopifyAdminUrl: r.shopifyAdminUrl || null,
          shopifyHandle: null, errorMessage: null, createdAt: new Date().toISOString(),
        });
        if (r.status === "PUSHED") {
          setPushResult({ shopifyAdminUrl: r.shopifyAdminUrl });
          setError(r.message || "Produk ini sudah pernah diimpor.");
        } else {
          pollJob(r.jobId);
        }
        return;
      }
      setActive({
        id: r.jobId, sourceUrl: url, sourceType: r.platform, status: "PENDING",
        extractedJson: null, shopifyAdminUrl: null, shopifyHandle: null,
        errorMessage: null, createdAt: new Date().toISOString(),
      });
      pollJob(r.jobId);
    } catch (e: any) {
      if (e.message === "NO_SESSION") router.replace("/login");
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function buildPushBody(): Partial<NormalizedProduct> {
    const body: any = { ...edits };
    // Filter images (remove removed)
    if (preview) {
      body.images = preview.images
        .map((src, i) => ({ src, removed: removedImageIdx.has(i) }))
        .filter((x) => !x.removed)
        .map((x) => x.src);
      // Reorder: primary first
      if (primaryImageIdx >= 0 && !removedImageIdx.has(primaryImageIdx)) {
        const primarySrc = body.images.splice(
          body.images.indexOf(preview.images[primaryImageIdx]), 1
        )[0];
        if (primarySrc) body.images.unshift(primarySrc);
      }
    }
    // Filter + edit variants
    if (preview?.variants) {
      body.variants = preview.variants
        .map((v, i) => ({ v, removed: removedVariants.has(i) }))
        .filter((x) => !x.removed)
        .map(({ v }) => ({
          ...v,
          stock: variantStockEdits[preview.variants.indexOf(v)] ?? v.stock,
        }));
    }
    // Storefront swatches (metafield bumi.colors) — always send the palette the
    // admin sees in the preview, including manually added colors. Removed
    // variants must not resurrect their color in the palette.
    if (preview) {
      const keptVariants = (preview.variants || []).filter(
        (_, i) => !removedVariants.has(i),
      );
      body.colors = buildColors(preview, keptVariants);
    }
    return body;
  }

  async function uploadImages(files: FileList) {
    if (!files.length) return;
    setError(""); setUploadingImages(true);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch("/api/imports/upload-images", {
        method: "POST",
        body: form,
      });
      if (res.status === 401) { router.replace("/login"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.uploaded && json.uploaded.length > 0) {
        const uploadedUrls: string[] = json.uploaded.map((u: any) => u.url);
        setUploadedImages((prev) => [...prev, ...uploadedUrls.filter((u) => !prev.includes(u))]);
        setEdits((d) => {
          // Never lose scraped images: fall back to the job's extracted images.
          const current = d.images ?? active?.extractedJson?.images ?? preview?.images ?? [];
          const images = [...current];
          for (const url of uploadedUrls) {
            if (!images.includes(url)) images.push(url);
          }
          return { ...d, images };
        });
      }
      if (json.rejected && json.rejected.length > 0) {
        const detail = json.rejected.map((r: any) => `${r.name}: ${r.reason}`).join("; ");
        setError(`Beberapa gambar ditolak — ${detail}`);
      }
    } catch (err: any) {
      if (err.message === "NO_SESSION") router.replace("/login");
      else setError(err.message);
    } finally {
      setUploadingImages(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onPush() {
    if (!active) return;
    if (!confirmPush) { setConfirmPush(true); return; }
    setError(""); setBusy(true); setPushResult(null);
    try {
      const pushBody = buildPushBody();
      const r = await api(`/api/imports/${active.id}/push`, "POST", pushBody);
      setPushResult({ shopifyAdminUrl: r.shopifyAdminUrl, warnings: r.warnings });
      setActive((j) => j ? { ...j, status: "PUSHED", shopifyAdminUrl: r.shopifyAdminUrl, shopifyHandle: r.shopifyHandle } : j);
      refreshHistory();
      // Reset form for next import
      setUrlInput(""); setEdits({}); setConfirmPush(false);
      setUploadedImages([]);
      setRemovedImageIdx(new Set()); setPrimaryImageIdx(0);
      setVariantStockEdits({}); setRemovedVariants(new Set());
    } catch (e: any) {
      if (e.message === "NO_SESSION") router.replace("/login");
      else setError(e.message);
      pollJob(active.id);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <main className="admin-shell"><p className="muted">Memuat…</p></main>;

  const preview: NormalizedProduct | null = active?.extractedJson
    ? { ...active.extractedJson, ...edits }
    : null;

  const activeImages = preview?.images || [];
  const activeVariants = preview?.variants || [];
  const keptVariants = activeVariants.filter((_, i) => !removedVariants.has(i));
  const activeColors = buildColors(preview, keptVariants);
  const originalIDR = preview?.specs?.originalPriceIDR;
  const audRate = preview?.specs?.audRateUsed;

  function updateColorAt(index: number, patch: Partial<NormalizedColor>) {
    const current = activeColors[index];
    if (!current) return;

    const nextPatch: Partial<NormalizedColor> = { ...patch };
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      // A blank name would make Shopify fall back to "Default" and break the
      // Color option; ignore it instead of corrupting the variant data.
      if (!name) return;
      const key = normalizeColorName(name);
      if (
        activeColors.some(
          (c, i) => i !== index && normalizeColorName(c.name) === key,
        )
      ) {
        setError(`Warna "${name}" sudah ada.`);
        return;
      }
      nextPatch.name = name;
    }

    const nextColors = activeColors.map((c, i) =>
      i === index ? { ...c, ...nextPatch } : c,
    );
    // Keep the Shopify Color option in sync when the name changes.
    const renaming =
      nextPatch.name != null && nextPatch.name !== current.name;
    const nextVariants = renaming && preview?.variants
      ? preview.variants.map((v) => {
          const color = colorOptionOf(v.options);
          return color && color.value === current.name
            ? {
                ...v,
                options: { ...v.options, [color.key]: nextPatch.name as string },
              }
            : v;
        })
      : undefined;
    setEdits((d) => ({
      ...d,
      colors: nextColors,
      ...(nextVariants ? { variants: nextVariants } : {}),
    }));
  }

  function removeColorAt(index: number) {
    const target = activeColors[index];
    if (!target) return;
    setEdits((d) => ({
      ...d,
      colors: activeColors.filter((_, i) => i !== index),
    }));
    // Also drop the variants that belong to the removed color.
    if (preview?.variants) {
      const n = new Set(removedVariants);
      preview.variants.forEach((v, i) => {
        const color = colorOptionOf(v.options);
        if (color && color.value === target.name) n.add(i);
      });
      setRemovedVariants(n);
    }
  }

  function addColor() {
    const name = newColorName.trim();
    if (!name) return;
    const nameKey = normalizeColorName(name);
    if (activeColors.some((c) => normalizeColorName(c.name) === nameKey)) {
      setError(`Warna "${name}" sudah ada.`);
      return;
    }
    const hex = normalizeHex(newColorHex) || hexForColorName(name);
    const nextColors = [...activeColors, { name, hex }];
    const { variants: nextVariants } = addColorToVariants(
      preview?.variants || [],
      name,
      hex,
      removedVariants,
      preview?.price,
    );

    setEdits((d) => ({
      ...d,
      colors: nextColors,
      variants: nextVariants,
    }));
    setError("");
    setNewColorName("");
    setNewColorHex("#CCCCCC");
  }

  const currentStep = active?.rawJson?.step;
  const stepOrder = ["scraping", "rehosting", "enriching", "converting"];
  const stepIdx = stepOrder.indexOf(currentStep);
  const isPending = active?.status === "PENDING";
  const steps = [
    { label: "Hubungi marketplace" },
    { label: "Ekstrak data" },
    { label: "Re-host gambar" },
    { label: "AI translate + generate" },
    { label: "Konversi AUD" },
  ];
  const isProcessing = active && (active.status === "PENDING" || active.status === "EXTRACTING");

  return (
    <main className="admin-shell">
      <div className="admin-header">
        <div>
          <h1>Import Produk</h1>
          <p className="muted">Tempel link Tokopedia, Shopee, atau website brand (JSON-LD) → ekstrak → push ke Shopify</p>
        </div>
      </div>

      <form className="import-bar" onSubmit={onExtract}>
        <input
          className="input"
          placeholder="https://www.tokopedia.com/... · https://shopee.co.id/... · https://brand.com/products/..."
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn--primary" type="submit" disabled={busy || !urlInput.trim()}>
          {busy ? "Memproses…" : "Ekstrak"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {/* Progress stepper */}
      {isProcessing && (
        <div className="card">
          <div className="stepper">
            {steps.map((s, i) => (
              <div key={i} className={`step ${i <= stepIdx ? "step--done" : ""} ${isPending ? (i === 0 ? "step--active" : "") : (i === stepIdx + 1 ? "step--active" : "")}`}>
                {s.label}
              </div>
            ))}
          </div>
          <p className="muted" style={{ textAlign: "center" }}>
            Mengambil data produk… ({elapsed}s)
          </p>
        </div>
      )}

      {/* Job status */}
      {active && !isProcessing && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Job {active.id.slice(-6)}</h3>
            <span className={`badge ${STATUS_BADGE[active.status] || "badge--dark"}`}>{active.status}</span>
          </div>
          <p className="muted" style={{ margin: "6px 0 0", wordBreak: "break-all" }}>{active.sourceUrl}</p>
          {active.errorMessage && <p className="error" style={{ margin: "8px 0 0" }}>{active.errorMessage}</p>}
        </div>
      )}

      {/* Preview — editable */}
      {preview && active?.status === "EXTRACTED" && (
        <div className="card">
          <h3>Pratinjau (editable sebelum push)</h3>
          <div className="preview-grid">
            {/* Left: form fields */}
            <div>
              <div className="row">
                <div className="field" style={{ flex: 2, minWidth: 200 }}>
                  <label>Judul</label>
                  <input className="input" value={preview.title || ""}
                    onChange={(e) => setEdits((d) => ({ ...d, title: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 100 }}>
                  <label>Harga (AUD)</label>
                  <input className="input" type="number" step="0.01" value={preview.price ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "") { setEdits((d) => ({ ...d, price: undefined })); return; }
                      const n = Number(v);
                      setEdits((d) => ({ ...d, price: Number.isNaN(n) ? undefined : n }));
                    }} />
                  {originalIDR && (
                    <p className="hint">Asli: Rp {Number(originalIDR).toLocaleString("id-ID")} IDR{audRate ? ` (÷ ${audRate})` : ""}</p>
                  )}
                </div>
              </div>
              <div className="row">
                <div className="field" style={{ flex: 2, minWidth: 200 }}>
                  <label>Merek</label>
                  <input className="input" value={preview.brand || ""}
                    onChange={(e) => setEdits((d) => ({ ...d, brand: e.target.value }))} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 100 }}>
                  <label>Harga coret (AUD)</label>
                  <input className="input" type="number" step="0.01" value={preview.compareAtPrice ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEdits((d) => ({ ...d, compareAtPrice: v === "" ? undefined : Number(v) || undefined }));
                    }} />
                </div>
              </div>
              <div className="row">
                <div className="field" style={{ flex: 1, minWidth: 120 }}>
                  <label>Kategori</label>
                  <select className="input" value={preview.specs?.category || ""}
                    onChange={(e) => setEdits((d) => ({ ...d, specs: { ...(d.specs || preview.specs || {}), category: e.target.value } }))}>
                    <option value="">—</option>
                    <option value="busy-book">Busy Book</option>
                    <option value="tshirts">T-Shirts &amp; Tops</option>
                    <option value="shorts">Shorts &amp; Bottoms</option>
                    <option value="dresses">Dresses</option>
                    <option value="outerwear">Outerwear</option>
                    <option value="accessories">Accessories</option>
                    <option value="baby">Baby</option>
                  </select>
                </div>
                <div className="field" style={{ flex: 1, minWidth: 120 }}>
                  <label>Audience</label>
                  <select className="input" value={preview.specs?.audience || "unisex"}
                    onChange={(e) => setEdits((d) => ({ ...d, specs: { ...(d.specs || preview.specs || {}), audience: e.target.value } }))}>
                    <option value="unisex">Unisex</option>
                    <option value="girls">Girls</option>
                    <option value="boys">Boys</option>
                    <option value="baby">Baby</option>
                  </select>
                </div>
                <div className="field" style={{ flex: 1, minWidth: 120 }}>
                  <label>Fibre</label>
                  <input className="input" value={preview.fibre || ""}
                    onChange={(e) => setEdits((d) => ({ ...d, fibre: e.target.value }))} />
                </div>
              </div>
              <div className="field">
                <label>Deskripsi</label>
                <textarea className="input" rows={5} value={preview.description || ""}
                  onChange={(e) => setEdits((d) => ({ ...d, description: e.target.value }))} />
              </div>
              <div className="field">
                <label>Material & Care</label>
                <textarea className="input" rows={3} value={preview.materialCare || ""}
                  onChange={(e) => setEdits((d) => ({ ...d, materialCare: e.target.value }))} />
              </div>
              <div className="field">
                <label>Size Guide</label>
                <textarea className="input" rows={4} value={preview.sizeGuide || ""}
                  onChange={(e) => setEdits((d) => ({ ...d, sizeGuide: e.target.value }))} />
              </div>
              <div className="field">
                <label>URL gambar size chart</label>
                <input className="input" value={preview.sizeChartImage || ""}
                  onChange={(e) => setEdits((d) => ({ ...d, sizeChartImage: e.target.value }))} />
              </div>
              <div className="field">
                <label>Shipping & Returns</label>
                <textarea className="input" rows={3} value={preview.shippingReturns || ""}
                  onChange={(e) => setEdits((d) => ({ ...d, shippingReturns: e.target.value }))} />
              </div>
              <p className="hint">
                Sumber: {preview.platform} · {preview.sourceUrl?.slice(0, 60)}
                {preview.sourceUrl && preview.sourceUrl.length > 60 ? "…" : ""}
              </p>
            </div>

            {/* Right: images + variants */}
            <div>
              {/* Images */}
              <div className="field">
                  <label>Gambar ({activeImages.length - removedImageIdx.size} aktif)</label>
                  <div className="preview-images">
                    {activeImages.map((src, i) => (
                      <div key={i} className={`image-thumb ${i === primaryImageIdx ? "image-thumb--primary" : ""} ${removedImageIdx.has(i) ? "image-thumb--removed" : ""}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" onClick={() => !removedImageIdx.has(i) && setPrimaryImageIdx(i)} style={{ cursor: "pointer" }} />
                        {i === primaryImageIdx && !removedImageIdx.has(i) && <div className="image-primary-tag">Utama</div>}
                        {uploadedImages.includes(src) && <div className="image-primary-tag" style={{ top: "auto", bottom: 0, background: "#0a6b4f" }}>Upload</div>}
                        <button className="image-remove" type="button"
                          onClick={() => {
                            const n = new Set(removedImageIdx);
                            if (n.has(i)) n.delete(i); else n.add(i);
                            setRemovedImageIdx(n);
                          }}>
                          {removedImageIdx.has(i) ? "↩" : "×"}
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="hint">
                    Klik gambar untuk set utama · × untuk hapus · ↩ untuk batal hapus
                    {uploadedImages.length > 0 ? ` · ${uploadedImages.length} gambar upload` : ""}
                    {preview.imageReport && preview.imageReport.rejected.length
                      ? ` · ${preview.imageReport.rejected.length} gambar sumber ditolak`
                      : ""}
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        uploadImages(e.target.files);
                      }
                    }}
                  />
                  <button
                    className="btn btn--secondary btn--sm"
                    type="button"
                    disabled={uploadingImages}
                    onClick={() => fileInputRef.current?.click()}
                    style={{ marginTop: 8 }}
                  >
                    {uploadingImages ? "Mengupload…" : "+ Upload gambar sendiri"}
                  </button>
                  {preview.imageReport && preview.imageReport.items.some((it) => it.lowRes) && (
                    <p className="hint" style={{ color: "#a15c00" }}>Ada gambar resolusi rendah — pertimbangkan hapus/ganti.</p>
                  )}
              </div>

              {/* Variants */}
              {activeVariants.length > 0 && (
                <div className="field">
                  <label>Varian ({activeVariants.length - removedVariants.size} aktif)</label>
                  {activeVariants.filter((_, i) => !removedVariants.has(i)).length > 100 && (
                    <p className="hint" style={{ color: "#a15c00" }}>
                      Lebih dari 100 varian — Shopify akan membuat maksimal 100. Kurangi varian atau
                      pisahkan per warna.
                    </p>
                  )}
                  {activeVariants.map((v, i) => {
                    const removed = removedVariants.has(i);
                    const stock = variantStockEdits[i] ?? v.stock ?? 0;
                    return (
                      <div key={i} className="variant-row" style={{ opacity: removed ? 0.4 : 1 }}>
                        <label>
                          <input type="checkbox" checked={!removed}
                            onChange={() => {
                              const n = new Set(removedVariants);
                              if (n.has(i)) n.delete(i); else n.add(i);
                              setRemovedVariants(n);
                            }} />
                          {Object.entries(v.options).map(([k, val]) => `${val}`).join(" · ")}
                        </label>
                        <input className="variant-stock-input" type="number" value={stock}
                          disabled={removed}
                          onChange={(e) => setVariantStockEdits((d) => ({ ...d, [i]: Number(e.target.value) || 0 }))} />
                        <span className="muted" style={{ minWidth: 70, textAlign: "right" }}>
                          {fmtAud(v.price ?? preview.price)}
                        </span>
                      </div>
                    );
                  })}
                  <p className="hint">Centang untuk aktif · edit stok · hapus yang tidak perlu</p>
                </div>
              )}

              {/* Colors — swatches on the storefront product page/listing */}
              <div className="field">
                <label>Warna / Colors ({activeColors.length})</label>
                {activeColors.length === 0 && (
                  <p className="hint">
                    Belum ada warna terdeteksi dari marketplace. Tambahkan manual di bawah.
                  </p>
                )}
                {activeColors.map((c, i) => (
                  <div key={i} className="color-row">
                    {preview.colorImages && Object.keys(preview.colorImages).length > 0 && (() => {
                      const currentSrc =
                        Object.entries(preview.colorImages).find(
                          ([k]) => k.toLowerCase() === c.name.toLowerCase(),
                        )?.[1] || "";
                      const pick = (value: string) => {
                        setEdits((d) => {
                          const map = { ...((d.colorImages as Record<string, string>) || preview.colorImages || {}) };
                          for (const key of Object.keys(map)) {
                            if (key.toLowerCase() === c.name.toLowerCase()) delete map[key];
                          }
                          if (value) map[c.name] = value;
                          return { ...d, colorImages: map };
                        });
                      };
                      return (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 200 }}>
                          {activeImages
                            .filter((_, idx) => !removedImageIdx.has(idx))
                            .slice(0, 10)
                            .map((src, idx) => (
                              <button
                                key={idx}
                                type="button"
                                title={`Gambar ${idx + 1}`}
                                aria-label={`Pilih gambar ${idx + 1} untuk ${c.name}`}
                                onClick={() => pick(currentSrc === src ? "" : src)}
                                style={{
                                  width: 34, height: 34, borderRadius: 6, padding: 0,
                                  border: currentSrc === src ? "2px solid #1e6e34" : "1px solid #ddd",
                                  cursor: "pointer", overflow: "hidden",
                                  background: "#f5f5f5",
                                }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              </button>
                            ))}
                        </div>
                      );
                    })()}
                    <input
                      className="input"
                      value={c.name}
                      placeholder="Color name"
                      onChange={(e) => updateColorAt(i, { name: e.target.value })}
                    />
                    <input
                      type="color"
                      className="color-row__hex"
                      value={normalizeHex(c.hex) || "#CCCCCC"}
                      onChange={(e) => updateColorAt(i, { hex: e.target.value })}
                      aria-label={`Hex for ${c.name}`}
                    />
                    <button
                      className="btn btn--ghost btn--sm"
                      type="button"
                      onClick={() => removeColorAt(i)}
                      aria-label={`Remove ${c.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="color-row">
                  <input
                    className="input"
                    placeholder="New color, e.g. Khaki"
                    value={newColorName}
                    onChange={(e) => setNewColorName(e.target.value)}
                  />
                  <input
                    type="color"
                    className="color-row__hex"
                    value={newColorHex}
                    onChange={(e) => setNewColorHex(e.target.value)}
                    aria-label="Hex for new color"
                  />
                  <button
                    className="btn btn--secondary btn--sm"
                    type="button"
                    onClick={addColor}
                  >
                    + Add
                  </button>
                </div>
                <p className="hint">
                  Hex dipakai untuk swatch storefront · warna pertama diterapkan ke varian yang ada; warna berikutnya dibuatkan varian stok 0 per size.
                </p>
              </div>
            </div>
          </div>

          {/* Push button */}
          <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className={`btn ${confirmPush ? "btn--danger" : "btn--primary"}`}
              onClick={onPush}
              disabled={busy}
            >
              {busy ? "Mengpush…" : confirmPush ? "Yakin? Push ke Shopify" : "Push ke Shopify"}
            </button>
            {confirmPush && !busy && (
              <button className="btn btn--ghost" onClick={() => setConfirmPush(false)}>Batal</button>
            )}
          </div>
        </div>
      )}

      {/* Push result */}
      {pushResult?.shopifyAdminUrl && (
        <div className="card" style={{ borderColor: "#1e6e34" }}>
          <h3 style={{ color: "#1e6e34" }}>✓ Produk di-push ke Shopify</h3>
          <p>
            <a href={pushResult.shopifyAdminUrl} target="_blank" rel="noreferrer">
              Buka produk di Shopify Admin ↗
            </a>
          </p>
          {pushResult.warnings && pushResult.warnings.length > 0 && (
            <p className="hint" style={{ color: "#a15c00" }}>
              Catatan: {pushResult.warnings.join(" · ")}
            </p>
          )}
          <button className="btn btn--ghost btn--sm" onClick={() => { setPushResult(null); setActive(null); }}>
            Import produk lain →
          </button>
        </div>
      )}

      {/* History */}
      <div className="card history">
        <h3>Riwayat Import</h3>
        {history.length === 0 && <p className="muted">Belum ada import.</p>}
        {history.map((j) => (
          <div className="history-item" key={j.id}>
            <span style={{ flex: 1, wordBreak: "break-all", color: j.status === "FAILED" ? "var(--muted)" : "inherit" }}>
              {j.sourceUrl.slice(0, 70)}{j.sourceUrl.length > 70 ? "…" : ""}
            </span>
            <span className={`badge ${STATUS_BADGE[j.status] || "badge--dark"}`}>{j.status}</span>
            {j.shopifyAdminUrl ? (
              <a href={j.shopifyAdminUrl} target="_blank" rel="noreferrer">Shopify ↗</a>
            ) : j.status === "EXTRACTED" || j.status === "FAILED" ? (
              <button className="btn btn--ghost btn--sm" onClick={() => { setActive(j); setEdits({}); setPushResult(null); setConfirmPush(false); }}>
                buka
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </main>
  );
}
