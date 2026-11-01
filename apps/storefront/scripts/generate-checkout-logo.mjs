import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'public/images/brand');
fs.mkdirSync(OUT_DIR, { recursive: true });

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #logo {
    width: 600px;
    height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: transparent;
    box-sizing: border-box;
    font-family: 'Outfit', sans-serif;
    color: #00408C;
  }
  .word {
    font-size: 62px;
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1;
    white-space: nowrap;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #F9B8AF;
    margin-top: 26px;
    flex: 0 0 auto;
  }
</style>
</head>
<body>
  <div id="logo"><span class="word">BUMI / BLOOM</span><span class="dot"></span></div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 640, height: 220 },
  deviceScaleFactor: 2,
});
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const el = await page.$('#logo');
const pngPath = path.join(OUT_DIR, 'bumi-bloom-checkout-logo.png');
await el.screenshot({
  path: pngPath,
  omitBackground: true,
});
await browser.close();

// Wrap the rendered PNG in an SVG so both files are pixel-identical.
const b64 = fs.readFileSync(pngPath).toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180" viewBox="0 0 600 180" role="img" aria-label="BUMI / BLOOM">
  <image href="data:image/png;base64,${b64}" width="600" height="180"/>
</svg>
`;
fs.writeFileSync(path.join(OUT_DIR, 'bumi-bloom-checkout-logo.svg'), svg);

console.log('Wrote public/images/brand/bumi-bloom-checkout-logo.png');
console.log('Wrote public/images/brand/bumi-bloom-checkout-logo.svg');
