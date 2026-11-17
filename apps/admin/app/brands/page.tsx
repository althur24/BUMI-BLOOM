"use client";

// Brand Priority — atur brand mana yang kartu produknya tampil lebih dulu di
// halaman Shop All (/products). Brand paling atas → produknya muncul duluan;
// di dalam tiap brand produk tetap terbaru dulu. Daftar brand di filter &
// /brands tetap alfabetis (tidak terpengaruh). Urutan disimpan ke
// /api/brand-order dan dibaca publik oleh storefront.
// Drag-and-drop native (HTML5) + tombol naik/turun untuk aksesibilitas.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

interface BrandOption {
  name: string;
  key: string;
  productCount: number;
}

interface OrderRow {
  brandKey: string;
  sortOrder: number;
}

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

export default function BrandsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setReady(true);
      try {
        const [optionsRes, orderRes] = await Promise.all([
          api("/api/brand-options"),
          api("/api/brand-order"),
        ]);
        const list: BrandOption[] = optionsRes.brands || [];
        const saved: OrderRow[] = (orderRes.order || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);

        // Build the working order: saved keys first (in their order), then the
        // remaining brands by name so nothing is hidden from the editor.
        const byKey = new Map(list.map((b) => [b.key, b]));
        const ordered: string[] = [];
        for (const row of saved) {
          if (byKey.has(row.brandKey) && !ordered.includes(row.brandKey)) ordered.push(row.brandKey);
        }
        const rest = list
          .filter((b) => !ordered.includes(b.key))
          .map((b) => b.key)
          .sort((a, b) => (byKey.get(a)!.name).localeCompare(byKey.get(b)!.name));

        setBrands(list);
        setOrder([...ordered, ...rest]);
      } catch (e: any) {
        if (e.message === "NO_SESSION") router.replace("/login");
        else setError(e.message);
      }
    })();
  }, [router]);

  const brandByKey = (key: string) => brands.find((b) => b.key === key);

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((prev) => {
      const next = prev.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setMessage("");
  }

  function onDragStart(index: number) {
    dragIndex.current = index;
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function onDrop(index: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from == null) return;
    move(from, index);
  }

  async function onSave() {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await api("/api/brand-order", "PUT", {
        order: order.map((brandKey, i) => ({ brandKey, sortOrder: i })),
      });
      setMessage("Tersimpan — urutan produk per brand langsung berlaku di Shop All.");
    } catch (e: any) {
      if (e.message === "NO_SESSION") router.replace("/login");
      else setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function resetDefault() {
    const sorted = brands.slice().sort((a, b) => a.name.localeCompare(b.name));
    setOrder(sorted.map((b) => b.key));
    setMessage("");
  }

  if (!ready) return <main className="admin-shell"><div className="muted">Memuat…</div></main>;

  return (
    <main className="admin-shell">
      <div className="admin-header">
        <h1>Prioritas Brand di Shop All</h1>
        <p className="muted">
          Tentukan brand mana yang kartu produknya muncul lebih dulu di halaman Shop All.
          Tarik untuk memindahkan, atau pakai tombol panah. Brand paling atas → produknya
          tampil paling awal; di dalam tiap brand produk tetap terbaru dulu. Brand yang tak
          diatur tampil setelahnya. Daftar brand di filter & halaman /brands tetap alfabetis.
          Tidak ada produk yang disembunyikan — hanya urutan tampilnya yang berubah.
        </p>
      </div>

      <div className="card">
        {brands.length === 0 ? (
          <p className="muted">Belum ada brand ditemukan di Shopify.</p>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {order.map((key, index) => {
              const brand = brandByKey(key);
              return (
                <li
                  key={key}
                  draggable
                  onDragStart={() => onDragStart(index)}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(index)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    marginBottom: 8,
                    border: "1px solid #e2dcd3",
                    borderRadius: 10,
                    background: "#fff",
                    cursor: "grab",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ color: "var(--muted)", fontSize: 18, lineHeight: 1, userSelect: "none" }}
                  >
                    ⋮⋮
                  </span>
                  <span style={{ width: 28, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                    {index + 1}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{brand?.name || key}</strong>
                    <span className="muted" style={{ marginLeft: 8 }}>
                      {brand ? `${brand.productCount} produk` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0}
                    aria-label="Naikkan"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => move(index, index + 1)}
                    disabled={index === order.length - 1}
                    aria-label="Turunkan"
                  >
                    ↓
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        {error && <p className="error">{error}</p>}
        {message && <p className="hint" style={{ color: "#1e6e34" }}>{message}</p>}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn--primary" onClick={onSave} disabled={saving || brands.length === 0}>
            {saving ? "Menyimpan…" : "Simpan Urutan"}
          </button>
          <button className="btn" onClick={resetDefault} disabled={saving || brands.length === 0}>
            Urutkan A–Z
          </button>
        </div>
      </div>
    </main>
  );
}
