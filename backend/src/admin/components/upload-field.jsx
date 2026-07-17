import React from "react";

// Minimal self-contained upload form. Posts multipart to the AdminJS action href;
// the action handler uploads to Supabase Storage and creates a MediaAsset, then
// returns a redirectUrl. (Plain elements + inline styles → no design-system import.)
const UploadField = (props) => {
  const { action } = props;

  const onSubmit = async (e) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    try {
      const res = await fetch(action.href, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        window.location.reload();
      }
    } catch (err) {
      alert("Upload failed: " + (err?.message || String(err)));
    }
  };

  return (
    <div style={{ padding: 32, maxWidth: 480 }}>
      <h2 style={{ marginTop: 0 }}>Upload product image</h2>
      <p style={{ color: "#666" }}>
        Uploads to the Supabase <code>products</code> bucket and creates a MediaAsset you can then attach to a product.
      </p>
      <form onSubmit={onSubmit} encType="multipart/form-data">
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Image file</label>
          <input type="file" name="file" accept="image/*" required />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Alt text</label>
          <input type="text" name="altText" placeholder="Describe the image" style={{ width: "100%", padding: 8 }} />
        </div>
        <button type="submit" style={{ padding: "8px 16px", cursor: "pointer" }}>
          Upload
        </button>
      </form>
    </div>
  );
};

export default UploadField;
