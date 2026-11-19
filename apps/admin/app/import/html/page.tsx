"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ExtractSummary {
  jobId: string;
  title?: string;
  brand?: string;
  price?: number;
  images?: number;
  variants?: number;
}

async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error("NO_SESSION");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// Fallback import path for when the server IP is blocked by the marketplace
// (Railway → Tokopedia times out). The admin copies the product page HTML from
// their own browser; the server only parses it (no marketplace network access),
// then the job can be reviewed and pushed from the normal Import page.
export default function PasteHtmlPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExtractSummary | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || html.trim().length < 200) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const created = await api("/api/imports/from-html", "POST", {
        url: url.trim(),
        html,
      });
      const detail = await api(`/api/imports/${created.jobId}`);
      const np = detail?.job?.extractedJson || {};
      setResult({
        jobId: created.jobId,
        title: np.title,
        brand: np.brand,
        price: np.price,
        images: Array.isArray(np.images) ? np.images.length : undefined,
        variants: Array.isArray(np.variants) ? np.variants.length : undefined,
      });
    } catch (e: any) {
      if (e.message === "NO_SESSION") router.replace("/login");
      else setError(e.message || "Gagal mem-parsing HTML.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-shell">
      <div className="admin-header">
        <div>
          <h1>Import via Tempel HTML</h1>
          <p className="muted">
            Dipakai saat server diblok marketplace. HTML diambil dari browser Anda
            (IP rumah), server hanya mem-parsing — tidak mengakses Tokopedia.
          </p>
        </div>
      </div>

      <div className="notice notice--info" role="note">
        <span>
          <strong>Cara ambil HTML:</strong> buka halaman produk di browser Anda → tekan{" "}
          <strong>F12</strong> → tab <strong>Console</strong> → jalankan{" "}
          <code>copy(document.documentElement.outerHTML)</code> → HTML tersalin →
          tempel di kotak di bawah.
        </span>
      </div>

      <form onSubmit={onSubmit}>
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="field__label">URL produk (untuk identitas & dedupe)</label>
          <input
            className="input"
            placeholder="https://www.tokopedia.com/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label className="field__label">HTML halaman produk</label>
          <textarea
            className="input"
            rows={8}
            placeholder="Tempel HTML lengkap halaman produk di sini…"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            disabled={busy}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
          />
          <p className="hint">
            Panjang HTML terdeteksi: <strong>{html.length.toLocaleString()}</strong> karakter
            (minimal ±2.000).
          </p>
        </div>

        <button
          className="btn btn--primary"
          type="submit"
          disabled={busy || !url.trim() || html.trim().length < 200}
        >
          {busy ? "Mem-parsing…" : "Ekstrak dari HTML"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>✓ HTML berhasil diekstrak</h3>
          <p style={{ margin: "4px 0" }}>
            <strong>{result.title || "(tanpa judul)"}</strong>
            {result.brand ? <span className="muted"> · {result.brand}</span> : null}
          </p>
          <p className="muted" style={{ margin: "4px 0 12px" }}>
            {result.price != null ? `Harga: Rp${Math.round(result.price).toLocaleString("id-ID")} · ` : ""}
            {result.images != null ? `${result.images} gambar · ` : ""}
            {result.variants != null ? `${result.variants} varian · ` : ""}
            Job <code>{result.jobId.slice(-6)}</code>
          </p>
          <p className="hint" style={{ marginBottom: 12 }}>
            Lanjutkan ke halaman Import untuk review (kategori, gambar, varian) lalu
            push ke Shopify. Job ini ada di paling atas daftar <strong>Riwayat Import</strong>.
          </p>
          <a className="btn btn--primary" href="/import">
            Buka halaman Import →
          </a>
        </div>
      )}
    </main>
  );
}
