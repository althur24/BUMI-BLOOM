"use client";

// Thumbnail-based image picker used by the product editor. A native <select>
// only shows "Gambar 1 / Gambar 2 / ..." which is unusable once a product has
// dozens of photos, so the admin picks by sight instead.

import type { KeyboardEvent } from "react";

export interface PickerImage {
  id: number;
  src: string;
  alt?: string | null;
}

export interface ImagePickerProps {
  images: PickerImage[];
  value: number | null;
  onChange: (imageId: number | null) => void;
  // Colour name → image id, so an image already used by another colourway can
  // be flagged instead of being silently shared.
  usedBy?: Record<string, number | null>;
  size?: number;
  max?: number;
  disabled?: boolean;
  ariaLabel?: string;
}

export function ImagePicker({
  images,
  value,
  onChange,
  usedBy = {},
  size = 40,
  max = 24,
  disabled = false,
  ariaLabel = "Pilih gambar",
}: ImagePickerProps) {
  const owners = new Map<number, string[]>();
  for (const [name, imageId] of Object.entries(usedBy)) {
    if (imageId == null) continue;
    const list = owners.get(imageId) || [];
    list.push(name);
    owners.set(imageId, list);
  }

  const visible = images.slice(0, max);

  function onKey(e: KeyboardEvent<HTMLButtonElement>, imageId: number) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onChange(value === imageId ? null : imageId);
    }
  }

  if (!visible.length) {
    return <p className="hint">Belum ada gambar. Upload dulu di bagian Gambar.</p>;
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{ display: "flex", gap: 4, flexWrap: "wrap" }}
    >
      {visible.map((img) => {
        const selected = value === img.id;
        const owned = (owners.get(img.id) || []).filter(Boolean);
        return (
          <button
            key={img.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(selected ? null : img.id)}
            onKeyDown={(e) => onKey(e, img.id)}
            title={
              owned.length
                ? `Gambar ${img.id} — dipakai: ${owned.join(", ")}`
                : `Gambar ${img.id}`
            }
            aria-label={`Gambar ${img.id}${owned.length ? `, dipakai ${owned.join(", ")}` : ""}`}
            aria-pressed={selected}
            style={{
              position: "relative",
              width: size,
              height: size,
              padding: 0,
              overflow: "hidden",
              borderRadius: 6,
              border: selected ? "2px solid #1e6e34" : "1px solid #ddd",
              background: "#f5f5f5",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.src}
              alt={img.alt || ""}
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            {owned.length > 0 && !selected && (
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  paddingBottom: 1,
                  fontSize: 8,
                  lineHeight: 1,
                  color: "#fff",
                  background: "linear-gradient(to top, rgba(0,0,0,.6), transparent 60%)",
                  pointerEvents: "none",
                }}
              >
                {owned[0].slice(0, 10)}
              </span>
            )}
          </button>
        );
      })}
      {images.length > visible.length && (
        <span className="hint" style={{ alignSelf: "center" }}>
          +{images.length - visible.length} gambar lain
        </span>
      )}
    </div>
  );
}
