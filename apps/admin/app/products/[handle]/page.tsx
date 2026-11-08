"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ImagePicker } from "@/components/ImagePicker";
import { hexForColorName } from "@/lib/colors";

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
  // Stable identity for React keys + edits (survives renames, unlike the name).
  key: string;
  name: string;
  hex: string;
  imageId: number | null;
  image?: string | null;
  // true when the name comes from the Shopify Color option (read-only).
  fromVariant?: boolean;
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
      .map((c: any, i: number) => ({
        key: `c${i}-${String(c?.name || "")}`,
        name: String(c?.name || ""),
        hex: String(c?.hex || "#CCCCCC"),
        imageId:
          c?.imageId != null && Number.isFinite(Number(c.imageId)) ? Number(c.imageId) : null,
        image: c?.image ? String(c.image) : null,
      }))
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
  const [noColor, setNoColor] = useState(false);
  // Colour name -> image id as loaded from Shopify. Used so saving does not
  // rewrite (and therefore null out) images the admin never touched.
  const [originalColorImages, setOriginalColorImages] = useState<Record<string, number | null>>({});
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
        const loadedColors = parseColorsJson(p.metafields.colors);
        setColors(loadedColors);
        setOriginalColorImages(
          Object.fromEntries(
            loadedColors.map((c) => [c.name.toLowerCase(), c.imageId ?? null]),
          ),
        );
        setNoColor(String(p.metafields.no_color || "") === "true");
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

  // ── Colour helpers ──────────────────────────────────────────────────────

  // One row per colourway: the metafield entry merged with the Shopify Color
  // option values and their variants, so the admin sees a single list.
  const colorRows = useMemo(() => {
    if (!product) return [] as {
      key: string;
      name: string;
      hex: string;
      imageId: number | null;
      fromVariant: boolean;
      varian: { id: number; stock: number }[];
    }[];

    const byName = new Map<
      string,
      {
        key: string;
        name: string;
        hex: string;
        imageId: number | null;
        fromVariant: boolean;
        varian: { id: number; stock: number }[];
      }
    >();

    // Colours from the metafield first (keeps their image + hex).
    for (const c of colors) {
      byName.set(c.name.toLowerCase(), {
        key: c.key,
        name: c.name,
        hex: c.hex,
        imageId: c.imageId ?? null,
        fromVariant: false,
        varian: [],
      });
    }

    // Then the Shopify Color option values.
    if (colorPosition > 0) {
      for (const v of product.variants) {
        const name = variantValue(v, colorPosition).trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const patch = variantEdits[v.id] || {};
        const stock = patch.inventoryQuantity ?? v.inventoryQuantity ?? 0;
        const existing = byName.get(key);
        if (existing) {
          existing.fromVariant = true;
          existing.varian.push({ id: v.id, stock: Number(stock) });
          if (existing.imageId == null && v.imageId != null) existing.imageId = v.imageId;
        } else {
          byName.set(key, {
            key: `v-${key}`,
            name,
            // Resolve from the colour dictionary so a variant-only colour is
            // not saved as neutral grey.
            hex: hexForColorName(name),
            imageId: v.imageId ?? null,
            fromVariant: true,
            varian: [{ id: v.id, stock: Number(stock) }],
          });
        }
      }
    }

    return [...byName.values()];
  }, [product, colors, colorPosition, variantEdits]);

  function updateColorName(key: string, name: string) {
    setColors((prev) =>
      prev.map((c) => (c.key === key ? { ...c, name } : c)),
    );
  }

  function updateColorHex(key: string, hex: string) {
    setColors((prev) => prev.map((c) => (c.key === key ? { ...c, hex } : c)));
  }

  // Picking an image for a colourway stores it on the colour entry; variants of
  // that colour are re-bound on save.
  function setColorImage(name: string, imageId: number | null) {
    const image = product?.images.find((img) => img.id === imageId)?.src || null;
    setColors((prev) => {
      const key = name.toLowerCase();
      const idx = prev.findIndex((c) => c.name.toLowerCase() === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], imageId, image };
        return next;
      }
      return [
        ...prev,
        {
          key: `new-${key}`,
          name,
          hex: "#CCCCCC",
          imageId,
          image,
        },
      ];
    });
  }

  function removeColor(key: string) {
    setColors((prev) => prev.filter((c) => c.key !== key));
  }

  const newColorKey = () =>
    `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  function addColor() {
    const name = newColorName.trim();
    if (!name) return;
    if (colors.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setError(`Warna "${name}" sudah ada.`);
      return;
    }
    setError("");
    setColors((prev) => [
      ...prev,
      { key: newColorKey(), name, hex: newColorHex, imageId: null },
    ]);
    setNewColorName("");
    setNewColorHex("#CCCCCC");
  }

  async function bindColorImages() {
    if (!product) return;
    setError("");
    setMessage("");
    try {
      const res = await api(`/api/products/${encodeURIComponent(handle)}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bind-color-images" }),
      });
      const refreshed = await api(`/api/products/${encodeURIComponent(handle)}`);
      setProduct(refreshed.product);
      setColors(parseColorsJson(refreshed.product.metafields.colors));
      setMessage(`${(res.bound || []).length} gambar warna diambil dari varian.`);
    } catch (e: any) {
      setError(e.message);
    }
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
      const refreshed = await api(`/api/products/${encodeURIComponent(handle)}`);
      setProduct(refreshed.product);
      setNoColor(false);
      setColors(parseColorsJson(refreshed.product.metafields.colors));
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
      // Colours + their image ids. When "tanpa warna" is ticked the palette is
      // cleared but Shopify's Color option (and its variants) stay untouched.
      const colorPayload = noColor
        ? []
        : colorRows.map((row) => ({
            name: row.name,
            hex: row.hex,
            imageId: row.imageId,
          }));

      // Only send variants whose colour image was actually changed by the
      // admin. Sending every colour would null out images that already exist.
      const changedColorImages = noColor
        ? []
        : colorRows
            .filter((row) => row.varian.length > 0)
            .filter(
              (row) =>
                (originalColorImages[row.name.toLowerCase()] ?? null) !==
                (row.imageId ?? null),
            )
            .map((row) => ({ colorName: row.name, imageId: row.imageId }));

      const payload: any = {
        title,
        bodyHtml,
        vendor,
        productType,
        status,
        tags,
        colors: colorPayload,
        noColor,
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

      const priceEdits = Object.entries(variantEdits)
        .map(([id, patch]) => {
          const live = product.variants.find((v) => v.id === Number(id));
          const entry: {
            id: number;
            price?: string;
            compareAtPrice?: string | null;
            sku?: string;
            inventoryQuantity?: number;
          } = { id: Number(id) };
          if (patch.price !== undefined && String(patch.price) !== live?.price) {
            entry.price = String(patch.price);
          }
          // compare_at_price: only send when the value really differs, so an
          // untouched empty input does not wipe an existing strike-through price.
          if (patch.compareAtPrice !== undefined) {
            const next = String(patch.compareAtPrice ?? "").trim();
            const prev = String(live?.compareAtPrice ?? "").trim();
            if (next !== prev) entry.compareAtPrice = next === "" ? null : next;
          }
          if (patch.sku !== undefined && patch.sku !== live?.sku) entry.sku = patch.sku;
          if (
            patch.inventoryQuantity !== undefined &&
            patch.inventoryQuantity !== live?.inventoryQuantity
          ) {
            entry.inventoryQuantity = patch.inventoryQuantity;
          }
          return entry;
        })
        .filter(
          (e) =>
            e.price !== undefined ||
            e.compareAtPrice !== undefined ||
            e.sku !== undefined ||
            e.inventoryQuantity !== undefined,
        );
      if (priceEdits.length) payload.variantPrices = priceEdits;

      const imageEdits = Object.entries(variantEdits)
        .filter(([, patch]) => patch.imageId !== undefined)
        .map(([id, patch]) => ({ id: Number(id), imageId: patch.imageId ?? null }));
      if (imageEdits.length) payload.variantImages = imageEdits;

      if (changedColorImages.length) payload.colorImages = changedColorImages;
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
      const freshColors = parseColorsJson(refreshed.product.metafields.colors);
      setColors(freshColors);
      setOriginalColorImages(
        Object.fromEntries(freshColors.map((c) => [c.name.toLowerCase(), c.imageId ?? null])),
      );
      setNoColor(String(refreshed.product.metafields.no_color || "") === "true");
      setMeta(refreshed.product.metafields || {});
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
        <h3>Varian &amp; Warna</h3>
        <p className="hint">
          Pilih gambar per warna — otomatis berlaku untuk semua ukuran warna itu. Swatch di
          storefront tetap memakai kode warna, bukan gambar.
        </p>

        {/* ── Bagian A: warna ───────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={noColor}
              onChange={(e) => setNoColor(e.target.checked)}
            />
            Tanpa warna (produk tanpa pilihan warna)
          </label>
          {noColor && colors.length > 0 && (
            <span className="hint" style={{ color: "#a15c00" }}>
              Warna di bawah akan dihapus saat disimpan.
            </span>
          )}
        </div>

        {!noColor && colorRows.map((row) => {
          const bound = row.varian.length;
          const stock = row.varian.reduce((sum, v) => sum + Number(v.stock || 0), 0);
          const usedByOthers = Object.fromEntries(
            colorRows
              .filter((r) => r.name.toLowerCase() !== row.name.toLowerCase())
              .map((r) => [r.name, r.imageId]),
          );
          return (
            <div key={row.key} className="color-row" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
              <ImagePicker
                images={product.images}
                value={row.imageId}
                onChange={(imageId) => setColorImage(row.name, imageId)}
                usedBy={usedByOthers}
                ariaLabel={`Gambar untuk warna ${row.name}`}
              />
              <input
                className="input"
                style={{ flex: "0 1 130px" }}
                value={row.name}
                placeholder="Nama warna"
                readOnly={row.fromVariant}
                title={row.fromVariant ? "Nama warna mengikuti opsi varian Shopify" : undefined}
                onChange={(e) => updateColorName(row.key, e.target.value)}
              />
              <input
                type="color"
                className="color-row__hex"
                value={/^#[0-9a-f]{6}$/i.test(row.hex) ? row.hex : "#CCCCCC"}
                onChange={(e) => updateColorHex(row.key, e.target.value.toUpperCase())}
                aria-label={`Kode warna untuk ${row.name}`}
              />
              <span className="muted" style={{ fontSize: 12, minWidth: 130 }}>
                {bound > 0 ? `${bound} ukuran · stok ${stock}` : "tanpa varian"}
              </span>
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                onClick={() => removeColor(row.key)}
                aria-label={`Hapus warna ${row.name}`}
              >
                ×
              </button>
            </div>
          );
        })}

        {!noColor && (
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
              aria-label="Kode warna baru"
            />
            <button className="btn btn--secondary btn--sm" type="button" onClick={addColor}>
              + Tambah warna
            </button>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {colorPosition > 0 && !noColor && (
            <button className="btn btn--ghost btn--sm" type="button" onClick={fillColorsFromVariants}>
              Isi warna dari varian
            </button>
          )}
          {colorPosition > 0 && (
            <button className="btn btn--ghost btn--sm" type="button" onClick={bindColorImages}>
              Ambil gambar dari varian
            </button>
          )}
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "16px 0" }} />

        {/* ── Bagian B: varian ──────────────────────────────────────────── */}
        <h3 style={{ marginTop: 0 }}>Varian</h3>
        <p className="hint">
          Harga, harga coret, stok, dan SKU per varian. Gambar mengikuti warna di atas
          (produk tanpa opsi warna memilih gambar per baris).
        </p>
        {product.variants.map((v) => {
          const patch = variantEdits[v.id] || {};
          const price = patch.price ?? v.price;
          const compareAt = (patch.compareAtPrice ?? v.compareAtPrice ?? "") as any;
          const sku = patch.sku ?? v.sku;
          const stock = patch.inventoryQuantity ?? v.inventoryQuantity;
          const imageId = patch.imageId !== undefined ? patch.imageId : v.imageId;
          const colorName = variantValue(v, colorPosition);
          const sizeName = variantValue(v, sizePosition);
          const variantTitle =
            (colorPosition > 0
              ? [colorName, sizeName].filter(Boolean).join(" · ")
              : sizeName || v.title);
          const inherited = colorPosition > 0
            ? colorRows.find((r) => r.name.toLowerCase() === colorName.toLowerCase())?.imageId ?? null
            : imageId;
          const thumb = product.images.find((img) => img.id === (inherited ?? imageId))?.src || null;

          return (
            <div key={v.id} className="variant-row" style={{ flexWrap: "wrap", gap: 6 }}>
              <span
                style={{
                  width: 28, height: 28, borderRadius: 4, overflow: "hidden",
                  background: "#f4f1ec", flex: "0 0 auto", display: "inline-flex",
                }}
              >
                {thumb ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : null}
              </span>
              <span style={{ flex: "1 1 140px", fontSize: 13 }}>{variantTitle}</span>
              <input
                className="input" style={{ width: 92 }} type="number" step="0.01"
                value={price}
                onChange={(e) => setVariantField(v.id, "price", e.target.value)}
                aria-label="Harga"
              />
              <input
                className="input" style={{ width: 92 }} type="number" step="0.01"
                placeholder="coret" value={compareAt}
                onChange={(e) => setVariantField(v.id, "compareAtPrice", e.target.value)}
                aria-label="Harga coret"
              />
              <input
                className="input" style={{ width: 84 }} type="number"
                value={stock}
                onChange={(e) => setVariantField(v.id, "inventoryQuantity", Number(e.target.value))}
                aria-label="Stok"
              />
              <input
                className="input" style={{ width: 110 }} placeholder="SKU"
                value={sku}
                onChange={(e) => setVariantField(v.id, "sku", e.target.value)}
                aria-label="SKU"
              />
              {colorPosition === 0 && (
                <ImagePicker
                  images={product.images}
                  value={imageId}
                  onChange={(next) => setVariantField(v.id, "imageId", next)}
                  size={28}
                  max={12}
                  ariaLabel={`Gambar untuk ${variantTitle}`}
                />
              )}
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
                    if (next.has(img.id)) {
                      next.delete(img.id);
                      setRemovedImages(next);
                      return;
                    }
                    const boundColors = colorRows
                      .filter((row) => row.imageId === img.id)
                      .map((row) => row.name);
                    const warning = boundColors.length
                      ? `\n\nGambar ini dipakai warna: ${boundColors.join(", ")}. Tautan warnanya akan dilepas.`
                      : "";
                    if (!window.confirm(`Hapus gambar ini dari produk?${warning}\n\nGambar akan dihapus permanen saat disimpan.`)) {
                      return;
                    }
                    if (boundColors.length) {
                      setColors((prev) =>
                        prev.map((c) =>
                          boundColors.some((n) => n.toLowerCase() === c.name.toLowerCase())
                            ? { ...c, imageId: null, image: null }
                            : c,
                        ),
                      );
                    }
                    next.add(img.id);
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
