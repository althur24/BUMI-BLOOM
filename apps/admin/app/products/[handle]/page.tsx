"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";

interface Variant {
  id: number;
  title: string;
  price: string;
  compareAtPrice: string | null;
  sku: string;
  inventoryQuantity: number;
  imageId: number | null;
  image: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  grams: number | null;
}

interface Image {
  id: number;
  src: string;
  alt: string | null;
  position: number;
}

interface ProductDetail {
  id: number;
  handle: string;
  title: string;
  bodyHtml: string;
  vendor: string;
  productType: string;
  status: string;
  tags: string;
  options: { name: string; values: string[] }[];
  variants: Variant[];
  images: Image[];
  metafields: Record<string, string>;
  manuallyEdited: boolean;
}

interface Color {
  name: string;
  hex: string;
}

const CATEGORIES = [
  "tshirts",
  "shorts",
  "dresses",
  "outerwear",
  "accessories",
  "baby",
  "busy-book",
];

const BUMI_TEXT_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "material", label: "Material & Care" },
  { key: "fibre", label: "Fibre" },
  { key: "size_guide", label: "Size Guide", hint: "Satu baris per ukuran, mis. 'S — 1–2 yrs'" },
  { key: "size_chart_image", label: "URL gambar size chart" },
  { key: "shipping_returns", label: "Shipping & Returns" },
  { key: "rating", label: "Rating" },
  { key: "sold_count", label: "Jumlah terjual" },
  { key: "badge", label: "Badge (new / bestseller)" },
];

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  if (res.status === 401) throw new Error("NO_SESSION");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function parseColorsJson(raw: string | undefined): Color[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c: any) => ({ name: String(c?.name || ""), hex: String(c?.hex || "#CCCCCC") }))
      .filter((c) => Boolean(c.name));
  } catch {
    return [];
  }
}

export default function ProductEditorPage() {
  const router = useRouter();
  const params = useParams<{ handle: string }>();
  const handle = decodeURIComponent(String(params?.handle || ""));

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [vendors, setVendors] = useState<string[]>([]);
  const [job, setJob] = useState<{ id: string; sourceUrl: string } | null>(null);

  const [title, setTitle] = useState("");
  const [vendor, setVendor] = useState("");
  const [productType, setProductType] = useState("");
  const [status, setStatus] = useState("active");
  const [tags, setTags] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");

  const [colors, setColors] = useState<Color[]>([]);
  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("#CCCCCC");

  const [meta, setMeta] = useState<Record<string, string>>({});
  const [variantEdits, setVariantEdits] = useState<Record<number, Partial<Variant>>>({});
  const [removedImages, setRemovedImages] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    if (!ready || !handle) return;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api(`/api/products/${encodeURIComponent(handle)}`);
        const p: ProductDetail = res.product;
        setProduct(p);
        setVendors(res.vendors || []);
        setJob(res.job || null);
        setTitle(p.title);
        setVendor(p.vendor);
        setProductType(p.productType);
        setStatus(p.status);
        setTags(p.tags);
        setBodyHtml(p.bodyHtml);
        setColors(parseColorsJson(p.metafields.colors));
        setMeta(p.metafields || {});
        setVariantEdits({});
        setRemovedImages(new Set());
      } catch (e: any) {
        if (e.message === "NO_SESSION") router.replace("/login");
        else setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [ready, handle, router]);

  const colorPosition = useMemo(() => {
    if (!product) return 0;
    const idx = product.options.findIndex((o) => /^(colou?r|colour|warna)$/i.test(o.name));
    return idx >= 0 ? idx + 1 : 0;
  }, [product]);

  const sizePosition = useMemo(() => {
    if (!product) return 0;
    const idx = product.options.findIndex((o) => /^(size|ukuran)$/i.test(o.name));
    return idx >= 0 ? idx + 1 : 0;
  }, [product]);

  function variantValue(v: Variant, position: number): string {
    if (!position) return "";
    return String((v as any)[`option${position}`] || "");
  }

  function setVariantField(id: number, field: keyof Variant, value: any) {
    setVariantEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  function addColor() {
    const name = newColorName.trim();
    if (!name) return;
    if (colors.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setError(`Warna "${name}" sudah ada.`);
      return;
    }
    setError("");
    setColors((prev) => [...prev, { name, hex: newColorHex }]);
    setNewColorName("");
    setNewColorHex("#CCCCCC");
  }

  async function fillColorsFromVariants() {
    if (!product) return;
    setError("");
    setMessage("");
    try {
      const res = await api(`/api/products/${encodeURIComponent(handle)}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "colors-from-variants" }),
      });
      setColors(res.colors || []);
      setMessage(`${(res.colors || []).length} warna diambil dari varian dan disimpan.`);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function uploadImages(files: FileList) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch("/api/imports/upload-images", { method: "POST", body: form });
      if (res.status === 401) { router.replace("/login"); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.rejected?.length) {
        setError(json.rejected.map((r: any) => `${r.name}: ${r.reason}`).join("; "));
      }
      // Attach uploaded images to the product immediately.
      for (const item of json.uploaded || []) {
        await fetch(`/api/products/${encodeURIComponent(handle)}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ src: item.url, alt: title }),
        });
      }
      const refreshed = await api(`/api/products/${encodeURIComponent(handle)}`);
      setProduct(refreshed.product);
      setMessage(`${(json.uploaded || []).length} gambar ditambahkan.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onSave() {
    if (!product) return;
    setSaving(true);
    setError("");
    setMessage("");
    setWarnings([]);
    try {
      const payload: any = {
        title,
        bodyHtml,
        vendor,
        productType,
        status,
        tags,
        colors,
        metafields: {
          material: meta.material || "",
          fibre: meta.fibre || "",
          size_guide: meta.size_guide || "",
          size_chart_image: meta.size_chart_image || "",
          shipping_returns: meta.shipping_returns || "",
          rating: meta.rating || "",
          sold_count: meta.sold_count || "",
          badge: meta.badge || "",
        },
      };

      const priceEdits = Object.entries(variantEdits).map(([id, patch]) => ({
        id: Number(id),
        price: patch.price,
        compareAtPrice: patch.compareAtPrice,
        sku: patch.sku,
        inventoryQuantity: patch.inventoryQuantity,
      }));
      if (priceEdits.length) payload.variantPrices = priceEdits;

      const imageEdits = Object.entries(variantEdits)
        .filter(([, patch]) => patch.imageId !== undefined)
        .map(([id, patch]) => ({ id: Number(id), imageId: patch.imageId ?? null }));
      if (imageEdits.length) payload.variantImages = imageEdits;

      if (removedImages.size) payload.removeImageIds = [...removedImages];

      const res = await api(`/api/products/${encodeURIComponent(handle)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setWarnings(res.warnings || []);
      setMessage(`Tersimpan (${(res.updated || []).length} perubahan).`);
      setVariantEdits({});
      setRemovedImages(new Set());
      const refreshed = await api(`/api/products/${encodeURIComponent(handle)}`);
      setProduct(refreshed.product);
    } catch (e: any) {
      if (e.message === "NO_SESSION") router.replace("/login");
      else setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!ready || loading) return <main className="admin-shell"><p className="muted">Memuat…</p></main>;
  if (!product) {
    return (
      <main className="admin-shell">
        <p className="error">{error || "Produk tidak ditemukan."}</p>
        <Link className="btn btn--ghost btn--sm" href="/products">← Kembali</Link>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <div className="admin-header">
        <div>
          <h1>{product.title}</h1>
          <p className="muted">
            /{product.handle} · {product.variants.length} varian · {product.images.length} gambar
            {product.manuallyEdited ? " · pernah diedit manual" : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn btn--ghost btn--sm" href="/products">← Daftar produk</Link>
          <a
            className="btn btn--ghost btn--sm"
            href={`https://p9gcf7-wj.myshopify.com/admin/products/${product.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Shopify ↗
          </a>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="hint" style={{ color: "#1e6e34" }}>{message}</p>}
      {warnings.length > 0 && (
        <p className="hint" style={{ color: "#a15c00" }}>Catatan: {warnings.join(" · ")}</p>
      )}

      <div className="card">
        <h3>Info produk</h3>
        <div className="field">
          <label>Judul</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label>Vendor</label>
            <input
              className="input"
              list="vendor-options"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            />
            <datalist id="vendor-options">
              {vendors.map((v) => <option key={v} value={v} />)}
            </datalist>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label>Kategori</label>
            <select className="input" value={productType} onChange={(e) => setProductType(e.target.value)}>
              <option value="">—</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label>Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">active</option>
              <option value="draft">draft</option>
              <option value="archived">archived</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label>Tags</label>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        <div className="field">
          <label>Deskripsi (HTML/teks)</label>
          <textarea className="input" rows={8} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <h3>Warna (filter storefront)</h3>
        <p className="hint">
          Warna di sini yang dipakai filter warna di storefront. Produk satu warna pun boleh diisi.
        </p>
        {colors.length === 0 && <p className="muted">Belum ada warna.</p>}
        {colors.map((c, i) => (
          <div key={i} className="color-row">
            <input
              className="input"
              value={c.name}
              placeholder="Nama warna"
              onChange={(e) => {
                const next = [...colors];
                next[i] = { ...next[i], name: e.target.value };
                setColors(next);
              }}
            />
            <input
              type="color"
              className="color-row__hex"
              value={/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "#CCCCCC"}
              onChange={(e) => {
                const next = [...colors];
                next[i] = { ...next[i], hex: e.target.value.toUpperCase() };
                setColors(next);
              }}
              aria-label={`Hex untuk ${c.name}`}
            />
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={() => setColors(colors.filter((_, idx) => idx !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <div className="color-row">
          <input
            className="input"
            placeholder="Warna baru, mis. Butter"
            value={newColorName}
            onChange={(e) => setNewColorName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addColor(); }}
          />
          <input
            type="color"
            className="color-row__hex"
            value={newColorHex}
            onChange={(e) => setNewColorHex(e.target.value)}
            aria-label="Hex warna baru"
          />
          <button className="btn btn--secondary btn--sm" type="button" onClick={addColor}>
            + Tambah
          </button>
        </div>
        {product.variants.length > 1 && colorPosition > 0 && colors.length === 0 && (
          <button className="btn btn--ghost btn--sm" type="button" onClick={fillColorsFromVariants}>
            Isi warna dari varian
          </button>
        )}
      </div>

      <div className="card">
        <h3>Varian</h3>
        <p className="hint">Ubah harga, harga coret, SKU, stok, dan gambar per varian.</p>
        {product.variants.map((v) => {
          const patch = variantEdits[v.id] || {};
          const price = patch.price ?? v.price;
          const compareAt = patch.compareAtPrice ?? v.compareAtPrice ?? "";
          const sku = patch.sku ?? v.sku;
          const stock = patch.inventoryQuantity ?? v.inventoryQuantity;
          const imageId = patch.imageId !== undefined ? patch.imageId : v.imageId;
          const variantTitle =
            [variantValue(v, colorPosition), variantValue(v, sizePosition)]
              .filter(Boolean)
              .join(" · ") || v.title;
          return (
            <div key={v.id} className="variant-row" style={{ flexWrap: "wrap", gap: 6 }}>
              <span style={{ flex: "1 1 150px", fontSize: 13 }}>{variantTitle}</span>
              <input
                className="input"
                style={{ width: 92 }}
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setVariantField(v.id, "price", e.target.value)}
                aria-label="Harga"
              />
              <input
                className="input"
                style={{ width: 92 }}
                type="number"
                step="0.01"
                placeholder="coret"
                value={compareAt as any}
                onChange={(e) => setVariantField(v.id, "compareAtPrice", e.target.value)}
                aria-label="Harga coret"
              />
              <input
                className="input"
                style={{ width: 90 }}
                type="number"
                value={stock}
                onChange={(e) => setVariantField(v.id, "inventoryQuantity", Number(e.target.value))}
                aria-label="Stok"
              />
              <input
                className="input"
                style={{ width: 120 }}
                placeholder="SKU"
                value={sku}
                onChange={(e) => setVariantField(v.id, "sku", e.target.value)}
                aria-label="SKU"
              />
              <select
                className="input"
                style={{ width: 120 }}
                value={imageId ?? ""}
                onChange={(e) => setVariantField(v.id, "imageId", e.target.value ? Number(e.target.value) : null)}
                aria-label="Gambar varian"
              >
                <option value="">— gambar —</option>
                {product.images.map((img, idx) => (
                  <option key={img.id} value={img.id}>Gambar {idx + 1}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>Gambar ({product.images.length})</h3>
        <div className="preview-images">
          {product.images.map((img, idx) => {
            const removed = removedImages.has(img.id);
            return (
              <div
                key={img.id}
                className={`image-thumb ${idx === 0 ? "image-thumb--primary" : ""} ${removed ? "image-thumb--removed" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.src} alt="" />
                <button
                  className="image-remove"
                  type="button"
                  onClick={() => {
                    const next = new Set(removedImages);
                    if (next.has(img.id)) next.delete(img.id);
                    else next.add(img.id);
                    setRemovedImages(next);
                  }}
                >
                  {removed ? "↩" : "×"}
                </button>
              </div>
            );
          })}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) uploadImages(e.target.files);
          }}
        />
        <button
          className="btn btn--secondary btn--sm"
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          style={{ marginTop: 8 }}
        >
          {uploading ? "Mengupload…" : "+ Upload gambar"}
        </button>
      </div>

      <div className="card">
        <h3>Detail produk</h3>
        {BUMI_TEXT_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            <textarea
              className="input"
              rows={f.key === "size_guide" || f.key === "material" ? 4 : 2}
              value={meta[f.key] || ""}
              onChange={(e) => setMeta((m) => ({ ...m, [f.key]: e.target.value }))}
            />
            {f.hint && <p className="hint">{f.hint}</p>}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <button className="btn btn--primary" type="button" onClick={onSave} disabled={saving}>
          {saving ? "Menyimpan…" : "Simpan ke Shopify"}
        </button>
        <Link className="btn btn--ghost" href="/products">Batal</Link>
        {job && (
          <span className="muted" style={{ fontSize: 12 }}>
            Sumber: {job.sourceUrl.slice(0, 60)}
          </span>
        )}
      </div>
    </main>
  );
}
