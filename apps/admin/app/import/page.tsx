"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { NormalizedProduct, ScraperVariant } from "@/lib/scrapers/base";

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

export default function ImportPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<ImportJob | null>(null);
  const [edits, setEdits] = useState<Partial<NormalizedProduct>>({});
  const [history, setHistory] = useState<ImportJob[]>([]);
  const [pushResult, setPushResult] = useState<{ shopifyAdminUrl?: string } | null>(null);
  const [error, setError] = useState("");
  const [confirmPush, setConfirmPush] = useState(false);
  const [removedImageIdx, setRemovedImageIdx] = useState<Set<number>>(new Set());
  const [primaryImageIdx, setPrimaryImageIdx] = useState(0);
  const [variantStockEdits, setVariantStockEdits] = useState<Record<number, number>>({});
  const [removedVariants, setRemovedVariants] = useState<Set<number>>(new Set());
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
    return body;
  }

  async function onPush() {
    if (!active) return;
    if (!confirmPush) { setConfirmPush(true); return; }
    setError(""); setBusy(true); setPushResult(null);
    try {
      const pushBody = buildPushBody();
      const r = await api(`/api/imports/${active.id}/push`, "POST", pushBody);
      setPushResult(r);
      setActive((j) => j ? { ...j, status: "PUSHED", shopifyAdminUrl: r.shopifyAdminUrl, shopifyHandle: r.shopifyHandle } : j);
      refreshHistory();
      // Reset form for next import
      setUrlInput(""); setEdits({}); setConfirmPush(false);
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
  const originalIDR = preview?.specs?.originalPriceIDR;
  const audRate = preview?.specs?.audRateUsed;

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
          <p className="muted">Tempel link Tokopedia / Shopee → ekstrak → push ke Shopify</p>
        </div>
      </div>

      <form className="import-bar" onSubmit={onExtract}>
        <input
          className="input"
          placeholder="https://www.tokopedia.com/... atau https://shopee.co.id/..."
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
              <div className="field">
                <label>Merek</label>
                <input className="input" value={preview.brand || ""}
                  onChange={(e) => setEdits((d) => ({ ...d, brand: e.target.value }))} />
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
              {activeImages.length > 0 && (
                <div className="field">
                  <label>Gambar ({activeImages.length - removedImageIdx.size} aktif)</label>
                  <div className="preview-images">
                    {activeImages.map((src, i) => (
                      <div key={i} className={`image-thumb ${i === primaryImageIdx ? "image-thumb--primary" : ""} ${removedImageIdx.has(i) ? "image-thumb--removed" : ""}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" onClick={() => !removedImageIdx.has(i) && setPrimaryImageIdx(i)} style={{ cursor: "pointer" }} />
                        {i === primaryImageIdx && !removedImageIdx.has(i) && <div className="image-primary-tag">Utama</div>}
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
                  <p className="hint">Klik gambar untuk set utama · × untuk hapus</p>
                </div>
              )}

              {/* Variants */}
              {activeVariants.length > 0 && (
                <div className="field">
                  <label>Varian ({activeVariants.length - removedVariants.size} aktif)</label>
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
