"use client";

// Hero Homepage — pilih produk Shopify yang tampil di kartu lengkung hero
// homepage (slot 1, 3, 5). Slot 2 & 4 adalah kartu karakter yang tetap.
// Slot kosong = ilustrasi default dari content/index.html.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

interface HeroProduct {
  handle: string;
  title: string;
  vendor: string;
  image: string | null;
}

interface HeroGroup {
  category: string;
  label: string;
  products: HeroProduct[];
}

// [position, label] — 2 & 4 are the fixed character cards.
const SLOTS: { position: number; label: string; locked: boolean; character?: string }[] = [
  { position: 1, label: "Kartu 1", locked: false },
  { position: 2, label: "Kartu 2", locked: true, character: "🦕" },
  { position: 3, label: "Kartu 3 (tengah)", locked: false },
  { position: 4, label: "Kartu 4", locked: true, character: "🐱" },
  { position: 5, label: "Kartu 5", locked: false },
];

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

export default function HeroPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [groups, setGroups] = useState<HeroGroup[]>([]);
  const [slots, setSlots] = useState<Record<number, string>>({ 1: "", 3: "", 5: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setReady(true);
      try {
        const [cardsRes, productsRes] = await Promise.all([
          api("/api/hero-cards"),
          api("/api/hero-products"),
        ]);
        const next: Record<number, string> = { 1: "", 3: "", 5: "" };
        for (const card of cardsRes.cards || []) {
          if ([1, 3, 5].includes(card.position)) {
            next[card.position] = card.productHandle || "";
          }
        }
        setSlots(next);
        setGroups(productsRes.groups || []);
      } catch (e: any) {
        if (e.message === "NO_SESSION") router.replace("/login");
        else setError(e.message);
      }
    })();
  }, [router]);

  const productByHandle = (handle: string): HeroProduct | null => {
    for (const g of groups) {
      const found = g.products.find((p) => p.handle === handle);
      if (found) return found;
    }
    return null;
  };

  async function onSave() {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await api("/api/hero-cards", "PUT", {
        cards: [1, 3, 5].map((position) => ({
          position,
          productHandle: slots[position] || null,
        })),
      });
      setMessage("Tersimpan — perubahan langsung tampil di homepage.");
    } catch (e: any) {
      if (e.message === "NO_SESSION") router.replace("/login");
      else setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <main className="admin-shell"><div className="muted">Memuat…</div></main>;

  return (
    <main className="admin-shell">
      <div className="admin-header">
        <h1>Hero Homepage</h1>
        <p className="muted">
          Pilih produk yang tampil di 5 kartu hero homepage. Slot 2 & 4 adalah kartu karakter
          (tetap). Slot kosong menampilkan ilustrasi default.
        </p>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: "stretch" }}>
          {SLOTS.map((slot) => {
            if (slot.locked) {
              return (
                <div key={slot.position} className="field" style={{ flex: 1, minWidth: 150, opacity: 0.55 }}>
                  <label>{slot.label}</label>
                  <div
                    style={{
                      aspectRatio: "3 / 4",
                      borderRadius: "999px 999px 12px 12px",
                      background: "var(--bg, #f6f2ec)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      fontSize: 34,
                    }}
                  >
                    <span>{slot.character}</span>
                  </div>
                  <p className="hint">Karakter — tidak bisa diubah</p>
                </div>
              );
            }

            const selected = slots[slot.position] ? productByHandle(slots[slot.position]) : null;

            return (
              <div key={slot.position} className="field" style={{ flex: 1, minWidth: 150 }}>
                <label>{slot.label}</label>
                <div
                  style={{
                    aspectRatio: "3 / 4",
                    borderRadius: "999px 999px 12px 12px",
                    background: "#ece7e0",
                    overflow: "hidden",
                    marginBottom: 8,
                  }}
                >
                  {selected ? (
                    selected.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selected.image}
                        alt={selected.title}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }} className="muted">
                        Tanpa gambar
                      </div>
                    )
                  ) : (
                    <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }} className="muted">
                      Ilustrasi default
                    </div>
                  )}
                </div>
                <select
                  className="input"
                  value={slots[slot.position]}
                  onChange={(e) => setSlots((s) => ({ ...s, [slot.position]: e.target.value }))}
                >
                  <option value="">— Ilustrasi default —</option>
                  {groups.map((g) => (
                    <optgroup key={g.category} label={g.label}>
                      {g.products.map((p) => (
                        <option key={p.handle} value={p.handle}>
                          {p.title}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selected && (
                  <p className="hint">
                    {selected.vendor} · <a href={`/products/${selected.handle}`} target="_blank" rel="noreferrer">lihat di storefront</a>
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <p className="hint">
          Kartu berbentuk lengkung dengan rasio 3:4 — gunakan foto portrait agar tidak terpotong.
          Kartu bisa diklik pengunjung menuju halaman produk.
        </p>

        {error && <p className="error">{error}</p>}
        {message && <p className="hint" style={{ color: "#1e6e34" }}>{message}</p>}

        <button className="btn btn--primary" onClick={onSave} disabled={saving || groups.length === 0}>
          {saving ? "Menyimpan…" : "Simpan Hero Cards"}
        </button>
      </div>
    </main>
  );
}
