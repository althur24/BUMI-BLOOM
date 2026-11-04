import { scrape } from "../lib/scrapers";
import { rehostImages } from "../lib/storage";
import { buildShopifyPushInput } from "../lib/import-mapper";
import { pushProductToShopify, adminRest } from "../lib/shopify";
import { closeBrowser } from "../lib/scrapers/browser";
const url = process.argv[2];
async function main() {
  const r = await scrape(url);
  if (!r.ok || !r.normalized) throw new Error("scrape failed: " + r.error);
  const np: any = r.normalized;
  np.title = "[TEST] " + np.title;
  const srcs = [...new Set([...np.images, ...(np.sizeChartImage?[np.sizeChartImage]:[]), ...Object.values(np.colorImages||{})].filter(Boolean))] as string[];
  const out = await rehostImages(srcs, { referer: url });
  const remap = (u?: string) => (u ? out.map.get(u) || u : u);
  np.images = np.images.map(remap);
  if (np.sizeChartImage) np.sizeChartImage = remap(np.sizeChartImage);
  np.colorImages = Object.fromEntries(Object.entries(np.colorImages||{}).map(([k,v])=>[k, remap(v as string)]));
  const input = buildShopifyPushInput(np, { handle: "zz-scan-" + Date.now() });
  const res = await pushProductToShopify(input, {});
  const p = await adminRest<any>("GET", `/products/${res.productId}.json`).catch(()=>({product:null}));
  const summary = {
    scrape: { images: np.images.length, variants: np.variants.length },
    rehost: { used: out.report.used, total: out.report.total, rejected: out.report.rejected.length },
    push: { productId: res.productId, warnings: res.warnings.length },
    shopify: p.product ? {
      images: p.product.images.length,
      variants: p.product.variants.length,
      withImage: p.product.variants.filter((v:any)=>v.image_id).length,
      totalInv: p.product.variants.reduce((s:number,v:any)=>s+(v.inventory_quantity||0),0),
    } : "FETCH_FAILED",
  };
  console.log(JSON.stringify(summary));
  await adminRest("DELETE", `/products/${res.productId}.json`).catch(()=>{});
  await closeBrowser();
}
main().catch(async (e) => { console.error("FAILED:", e?.message || e); await closeBrowser(); process.exit(1); });
