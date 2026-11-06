import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// Email variant of the storefront logo.
//
// The peach dot is NOT centred on the text — it sits below the optical centre,
// reading as a full stop. That is the intended storefront design.
//
// Strategy: render the wordmark first, measure its real ink box from the
// rendered pixels (not font metrics, which exclude overshoot and don't account
// for letter-spacing), then draw the dot at the exact matching position.
//
// Output: public/images/brand/bumi-bloom-email-logo.png (transparent, retina).
// Run: npm run generate:email-logo -w apps/storefront

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'public/images/brand');
fs.mkdirSync(OUT_DIR, { recursive: true });

const FONT_SIZE = 64;
const TEXT = 'BUMI / BLOOM';
const LETTER_SPACING = -0.025; // em

// Ratios taken from the live storefront logo (glyph box 101px tall):
const REF_GLYPH_HEIGHT = 101;
const REF_DOT_DIAMETER = 24; // 23.8%
const REF_DOT_CENTRE_BELOW_TEXT_CENTRE = 23.5; // 23.3%
const REF_DOT_GAP = 27; // 26.7%

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 300 },
  deviceScaleFactor: 2,
});

const baseHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #word {
    position: absolute;
    left: 40px; top: 40px;
    display: inline-block;
    font-family: 'Outfit', sans-serif;
    font-size: ${FONT_SIZE}px;
    font-weight: 700;
    letter-spacing: ${LETTER_SPACING}em;
    line-height: 1;
    white-space: nowrap;
    color: #00408C;
  }
  #dot {
    position: absolute;
    border-radius: 50%;
    background: #F9B8AF;
  }
</style>
</head>
<body><span id="word">${TEXT}</span><span id="dot"></span></body>
</html>`;

await page.setContent(baseHtml, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

// Page-space bounding box of the text element (used for the dot's X/Y origin).
const wordBox = await page.evaluate(() => {
  const r = document.getElementById('word').getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
});

// Screenshot the region around the word and find the real ink box in pixels.
const PAD_SCAN = 60;
const clip = {
  x: Math.max(0, wordBox.left - PAD_SCAN),
  y: Math.max(0, wordBox.top - PAD_SCAN),
  width: wordBox.width + PAD_SCAN * 2,
  height: wordBox.height + PAD_SCAN * 2,
};
const scanBuf = await page.screenshot({ clip, omitBackground: true });

// Decode PNG in the page (canvas) to find opaque ink bounds.
const ink = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 60) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY, width, height };
}, scanBuf.toString('base64'));

// Convert ink bounds from the DPR-scaled scan image back to CSS pixels.
const dpr = 2;
const inkLeft = clip.x + ink.minX / dpr;
const inkRight = clip.x + ink.maxX / dpr;
const inkTop = clip.y + ink.minY / dpr;
const inkBottom = clip.y + ink.maxY / dpr;
const inkHeight = inkBottom - inkTop;
const inkCentreY = (inkTop + inkBottom) / 2;

// Scale storefront ratios to this render's ink height.
const scale = inkHeight / REF_GLYPH_HEIGHT;
const dotDiameter = Math.round(REF_DOT_DIAMETER * scale);
const dotCentreOffset = REF_DOT_CENTRE_BELOW_TEXT_CENTRE * scale;
const dotGap = Math.round(REF_DOT_GAP * scale);
const dotLeft = inkRight + dotGap;
const dotTop = inkCentreY + dotCentreOffset - dotDiameter / 2;

await page.evaluate(
  ({ left, top, size }) => {
    const dot = document.getElementById('dot');
    dot.style.left = `${left}px`;
    dot.style.top = `${top}px`;
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
  },
  { left: dotLeft, top: dotTop, size: dotDiameter },
);

// Crop tightly around text + dot with a small even margin.
const MARGIN = 10;
const outClip = {
  x: inkLeft - MARGIN,
  y: inkTop - MARGIN,
  width: inkRight - inkLeft + dotGap + dotDiameter + MARGIN * 2,
  height: inkHeight + MARGIN * 2,
};

const pngPath = path.join(OUT_DIR, 'bumi-bloom-email-logo.png');
await page.screenshot({
  path: pngPath,
  clip: outClip,
  omitBackground: true,
});
await browser.close();

console.log('Wrote public/images/brand/bumi-bloom-email-logo.png');
console.log(
  `  ink height ${inkHeight.toFixed(1)}px · dot ${dotDiameter}px · ` +
    `centre offset ${dotCentreOffset.toFixed(1)}px · gap ${dotGap}px`,
);
