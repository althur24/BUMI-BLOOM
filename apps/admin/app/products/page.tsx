"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";

interface ProductSummary {
  id: number;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  status: string;
  image: string | null;
  price: string;
  variantCount: number;
  variantsWithImage: number;
  imageCount: number;
  colors: { name: string; hex: string; imageId?: number | null }[];
  noColor: boolean;
  colorOptionCount: number;
  sizeGuide: boolean;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  issues: string[];
}

type Filter = "" | "issues" | "no-colors" | "variants-no-image" | "no-size-guide";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "", label: "Semua" },
  { value: "issues", label: "Perlu diperbaiki" },
  { value: "no-colors", label: "Tanpa warna" },
  { value: "variants-no-image", label: "Varian tanpa gambar" },
  { value: "no-size-guide", label: "Tanpa size guide" },
];

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  if (res.status === 401) throw new Error("NO_SESSION");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export default function ProductsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [counts, setCounts] = useState({ total: 0, withIssues: 0, noColors: 0 });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyHandle, setBusyHandle] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setReady(true);
    })();
  }, [router]);

  const load = useCallback(
    async (opts: { search?: string; filter?: Filter } = {}) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        const q = opts.search ?? search;
        const f = opts.filter ?? filter;
        if (q.trim()) params.set("search", q.trim());
        if (f) params.set("filter", f);
        const res = await api(`/api/products?${params.toString()}`);
        setProducts(res.products || []);
        setCounts(res.counts || { total: 0, withIssues: 0, noColors: 0 });
      } catch (e: any) {
        if (e.message === "NO_SESSION") router.replace("/login");
        else setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [router, search, filter],
  );

  useEffect(() => {
    if (ready) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function runFix(handle: string, action: string) {
    setBusyHandle(handle);
    setError("");
    setMessage("");
    try {
      const res = await api(`/api/products/${encodeURIComponent(handle)}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.message) setMessage(`${handle}: ${res.message}`);
      else if (action === "colors-from-variants")
        setMessage(`${handle}: ${res.colors.length} warna disimpan.`);
      else if (action === "normalize-vendor")
        setMessage(`${handle}: vendor "${res.previous}" → "${res.vendor}".`);
      else if (action === "clean-handle")
        setMessage(`${handle}: handle → "${res.handle}".`);
      await load();
    } catch (e: any) {
      if (e.message === "NO_SESSION") router.replace("/login");
      else setError(e.message);
    } finally {
      setBusyHandle("");
    }
  }

  if (!ready) return <main className="admin-shell"><p className="muted">Memuat…</p></main>;

  return (
    <main className="admin-shell">
      <div className="admin-header">
        <div>
          <h1>Produk</h1>
          <p className="muted">
            Edit produk yang sudah live di Shopify tanpa import ulang. Data diambil langsung
            dari Shopify, jadi perubahan langsung tampil di storefront.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label>Cari produk</label>
            <input
              className="input"
              placeholder="Judul, vendor, atau handle…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") load();
              }}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Filter</label>
            <select
              className="input"
              value={filter}
              onChange={(e) => {
                const next = e.target.value as Filter;
                setFilter(next);
                load({ filter: next });
              }}
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: "0 0 auto" }}>
            <button className="btn btn--primary" type="button" onClick={() => load()} disabled={loading}>
              {loading ? "Memuat…" : "Cari"}
            </button>
          </div>
        </div>
        <p className="hint">
          {counts.total} produk · {counts.withIssues} perlu diperbaiki · {counts.noColors} tanpa warna
          {filter === "issues" ? " · sedang menampilkan yang perlu diperbaiki" : ""}
        </p>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="hint" style={{ color: "#1e6e34" }}>{message}</p>}

      <div className="card">
        {products.length === 0 && !loading && (
          <p className="muted">Tidak ada produk yang cocok.</p>
        )}
        {products.map((p) => (
          <div key={p.id} className="history-item" style={{ alignItems: "flex-start", gap: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.image || ""}
              alt=""
              style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, background: "#f4f1ec" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>{p.title}</strong>
                <span className={`badge ${p.status === "active" ? "badge--green" : "badge--dark"}`}>
                  {p.status}
                </span>
                {p.issues.length > 0 && (
                  <span className="badge badge--yellow">{p.issues.length} masalah</span>
                )}
                {p.colors.length === 0 && p.noColor && (
                  <span className="badge badge--dark">Tanpa warna</span>
                )}
              </div>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                {p.vendor || "—"} · {p.variantCount} varian · {p.imageCount} gambar · ${p.price}
                {p.sourcePlatform ? ` · ${p.sourcePlatform}` : ""}
              </p>
              {p.issues.length > 0 && (
                <p className="hint" style={{ margin: "4px 0 0" }}>{p.issues.join(" · ")}</p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                <Link
                  className="btn btn--secondary btn--sm"
                  href={`/products/${encodeURIComponent(p.handle)}`}
                >
                  Edit
                </Link>
                {p.colorOptionCount > 0 && p.colors.length === 0 && (
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    disabled={busyHandle === p.handle}
                    onClick={() => runFix(p.handle, "colors-from-variants")}
                  >
                    {busyHandle === p.handle ? "Memproses…" : "Isi warna dari varian"}
                  </button>
                )}
                <a
                  className="btn btn--ghost btn--sm"
                  href={`https://p9gcf7-wj.myshopify.com/admin/products/${p.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Shopify ↗
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
