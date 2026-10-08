import { enrichProduct } from "../lib/ai/enrich";

async function main() {
  const r = await enrichProduct({
    platform: "SHOPEE",
    sourceUrl: "https://shopee.co.id/x",
    title: "[COD] Kemeja Anak Laki Lucu Murah Banget 🚀",
    description: "<p>Kemeja bagus murah</p>",
    images: [],
    variants: [],
  });
  console.log("aiUsed:", r.aiUsed, "| provider:", r.aiMeta?.provider);
  console.log("error:", r.aiMeta?.error);
  console.log("title:", JSON.stringify(r.enriched.title));
  console.log("desc:", JSON.stringify(r.enriched.description));
  console.log("specs:", JSON.stringify(r.enriched.specs));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
