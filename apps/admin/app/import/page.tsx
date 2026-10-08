"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { NormalizedProduct } from "@/lib/scrapers/base";

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
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: "badge--yellow",
  EXTRACTING: "badge--yellow",
  EXTRACTED: "badge--dark",
  PUSHING: "badge--yellow",
  PUSHED: "badge--green",
  FAILED: "badge--coral",
};

// Same-origin fetch — the Supabase session cookie is sent automatically
// (no manual Bearer header). A 401 means the session is gone → redirect /login.
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
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth gate + load history on mount.
  useEffect(() => {
    (async () => {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setReady(true);
      refreshHistory().catch(() => {});
    })();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
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

  const pollJob = useCallback(
    (jobId: string) => {
      if (pollRef.current) clearTimeout(pollRef.current);
      const tick = async () => {
        try {
          const r = await api(`/api/imports/${jobId}`);
          const job = r.job as ImportJob;
          setActive(job);
          if (job.status === "EXTRACTED" || job.status === "FAILED") {
            if (job.extractedJson) setEdits({});
            return;
          }
          pollRef.current = setTimeout(tick, 2000);
        } catch (e: any) {
          if (e.message === "NO_SESSION") router.replace("/login");
          else setError(e.message);
        }
      };
      tick();
    },
    [router],
  );

  async function onExtract(e: React.FormEvent) {
    e.preventDefault();
    const url = urlInput.trim();
    if (!url) return;
    setError("");
    setPushResult(null);
    setActive(null);
    setBusy(true);
    try {
      const r = await api("/api/imports", "POST", { url });
      setActive({ id: r.jobId, sourceUrl: url, sourceType: r.platform, status: "PENDING", extractedJson: null, shopifyAdminUrl: null, shopifyHandle: null, errorMessage: null, createdAt: new Date().toISOString() });
      pollJob(r.jobId);
    } catch (e: any) {
      if (e.message === "NO_SESSION") router.replace("/login");
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onPush() {
    if (!active) return;
    setError("");
    setBusy(true);
    setPushResult(null);
    try {
      const r = await api(`/api/imports/${active.id}/push`, "POST", edits);
      setPushResult(r);
      setActive((j) => (j ? { ...j, status: "PUSHED", shopifyAdminUrl: r.shopifyAdminUrl, shopifyHandle: r.shopifyHandle } : j));
      refreshHistory();
    } catch (e: any) {
      if (e.message === "NO_SESSION") router.replace("/login");
      else setError(e.message);
      // refresh job (likely reverted to EXTRACTED with errorMessage)
      pollJob(active.id);
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  }

  if (!ready) return <main className="admin-shell"><p className="muted">Loading…</p></main>;

  const preview: NormalizedProduct | null = active?.extractedJson
    ? { ...active.extractedJson, ...edits }
    : null;

  return (
    <main className="admin-shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Import Produk</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Tempel link Shopee / Tokopedia → ekstrak → push ke Shopify.</p>
        </div>
        <button className="btn btn--ghost" onClick={onSignOut}>Sign Out</button>
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
          {busy ? "…" : "Extract"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {active && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Job {active.id.slice(-6)}</h3>
            <span className={`badge ${STATUS_BADGE[active.status] || "badge--dark"}`}>{active.status}</span>
          </div>
          <p className="muted" style={{ margin: "6px 0 0", wordBreak: "break-all" }}>{active.sourceUrl}</p>
          {active.errorMessage && <p className="error" style={{ margin: "8px 0 0" }}>{active.errorMessage}</p>}
        </div>
      )}

      {preview && (
        <div className="card">
          <h3>Preview (editable sebelum push)</h3>
          <div className="row">
            <div className="field" style={{ flex: 2, minWidth: 240 }}>
              <label>Title</label>
              <input
                className="input"
                value={preview.title || ""}
                onChange={(e) => setEdits((d) => ({ ...d, title: e.target.value }))}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 120 }}>
              <label>Price ({preview.currency || "IDR"})</label>
              <input
                className="input"
                type="number"
                value={preview.price ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    setEdits((d) => ({ ...d, price: undefined }));
                    return;
                  }
                  const n = Number(v);
                  setEdits((d) => ({ ...d, price: Number.isNaN(n) ? undefined : n }));
                }}
              />
            </div>
          </div>
          <div className="field">
            <label>Brand</label>
            <input
              className="input"
              value={preview.brand || ""}
              onChange={(e) => setEdits((d) => ({ ...d, brand: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              className="input"
              rows={3}
              value={preview.description || ""}
              onChange={(e) => setEdits((d) => ({ ...d, description: e.target.value }))}
            />
          </div>
          {preview.images?.length > 0 && (
            <div className="field">
              <label>Images ({preview.images.length})</label>
              <div className="preview-images">
                {preview.images.slice(0, 10).map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt="" />
                ))}
              </div>
            </div>
          )}
          <button className="btn btn--primary" onClick={onPush} disabled={busy}>
            {busy ? "Pushing…" : "Push to Shopify"}
          </button>
        </div>
      )}

      {pushResult?.shopifyAdminUrl && (
        <div className="card">
          <h3>✓ Pushed</h3>
          <p>Produk dibuat di Shopify: <a href={pushResult.shopifyAdminUrl} target="_blank" rel="noreferrer">{pushResult.shopifyAdminUrl}</a></p>
        </div>
      )}

      <div className="card history">
        <h3>Riwayat Import</h3>
        {history.length === 0 && <p className="muted">Belum ada.</p>}
        {history.map((j) => (
          <div className="history-item" key={j.id}>
            <span style={{ flex: 1, wordBreak: "break-all" }}>{j.sourceUrl}</span>
            <span className={`badge ${STATUS_BADGE[j.status] || "badge--dark"}`}>{j.status}</span>
            {j.shopifyAdminUrl ? (
              <a href={j.shopifyAdminUrl} target="_blank" rel="noreferrer">Shopify ↗</a>
            ) : (
              <button className="btn btn--ghost" onClick={() => { setActive(j); setEdits({}); setPushResult(null); }}>
                buka
              </button>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
