// size-labels.mjs — JS port of apps/admin/lib/size-labels.ts for Node scripts
// (migration, verification). Keep in sync with the TS module; a parity test in
// apps/admin/scripts/unit-test.ts guards against drift.

export const SIZE_LABEL_MODES = ['age', 'height', 'manual'];

export function normaliseSizeLabelMode(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return SIZE_LABEL_MODES.includes(v) ? v : 'age';
}

const HEIGHT_AGE_BANDS = [
  { min: 80, max: 86, age: '1–2 yrs' },
  { min: 87, max: 98, age: '2–3 yrs' },
  { min: 99, max: 104, age: '3–4 yrs' },
  { min: 105, max: 110, age: '4–5 yrs' },
  { min: 111, max: 116, age: '5–6 yrs' },
  { min: 117, max: 122, age: '6–7 yrs' },
  { min: 123, max: 128, age: '7–8 yrs' },
  { min: 129, max: 134, age: '8–9 yrs' },
  { min: 135, max: 140, age: '9–10 yrs' },
  { min: 141, max: 146, age: '10–11 yrs' },
  { min: 147, max: 152, age: '11–12 yrs' },
];

const HEIGHT_EXACT_AGE = {
  '90': '2–3 yrs', '100': '3–4 yrs', '110': '4–5 yrs', '120': '5–6 yrs',
  '130': '6–7 yrs', '140': '7–8 yrs', '150': '8–9 yrs', '160': '9–10 yrs',
};

const KNOWN_SIZE_PREFIXES = ['XXXXL', 'XXXL', 'XXL', 'XL', 'XS', 'XXS', 'XXXS', 'L', 'M', 'S'];

function normaliseSizeDash(s) {
  return String(s)
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/(\d)\s*-\s*(\d)/g, '$1–$2');
}

function upperSizePrefix(s) {
  const m = String(s).match(/^([A-Za-z]{1,4})(\b|\s|\()/);
  if (!m) return s;
  const up = m[1].toUpperCase();
  if (!KNOWN_SIZE_PREFIXES.includes(up)) return s;
  return up + s.slice(m[1].length);
}

export function heightToAge(cm) {
  const n = typeof cm === 'number' ? cm : Number(String(cm).trim());
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (HEIGHT_EXACT_AGE[String(n)]) return HEIGHT_EXACT_AGE[String(n)];
  const band = HEIGHT_AGE_BANDS.find((b) => n >= b.min && n <= b.max);
  if (band) return band.age;
  return n + ' cm';
}

export function parseSizeMeta(raw) {
  const original = String(raw == null ? '' : raw).trim();
  const out = { label: original };
  if (!original) return out;
  const s = normaliseSizeDash(original);

  if (/(?:^|[\s-])adult(?:$|[\s-])/i.test(s)) out.adult = true;

  const weight = s.match(/\b(?:BB\s*)?(\d{1,3})\s*[–-]\s*(\d{1,3})\s*KG\b/i);
  const weightSingle = s.match(/\b(?:BB\s*)?(\d{1,3})\s*KG\b/i);
  if (weight) out.weightKg = { min: Number(weight[1]), max: Number(weight[2]) };
  else if (weightSingle) out.weightKg = { min: Number(weightSingle[1]), max: Number(weightSingle[1]) };

  const years = s.match(/(\d+)\s*[–-]\s*(\d+)\s*(?:TAHUN|THN|Y|YO|YRS?|YEARS?|T(?![a-z]))/i);
  if (years) out.age = years[1] + '–' + years[2] + ' yrs';
  else {
    const singleYear = s.match(/(\d+)\s*(?:TAHUN|THN|Y|YO|YRS?|YEARS?)/i);
    if (singleYear) out.age = singleYear[1] + ' ' + (Number(singleYear[1]) === 1 ? 'yr' : 'yrs');
  }

  if (!out.age) {
    const months = s.match(/(\d+)\s*[–-]\s*(\d+)\s*(?:BLN|BULAN|MONTHS?|MTH|M(?![a-z]))\b/i);
    if (months) out.age = months[1] + '–' + months[2] + ' months';
    else {
      const singleMonth = s.match(/(\d+)\s*(?:BLN|BULAN|MONTHS?|MTH)\b/i);
      if (singleMonth) out.age = singleMonth[1] + ' months';
    }
  }

  if (!out.age && !out.adult) {
    const toddler = s.match(/^(\d+)\s*T$/i);
    if (toddler) out.age = toddler[1] + '–' + (Number(toddler[1]) + 1) + ' yrs';
  }

  const cm = s.match(/\b(\d{2,3})\s*CM\b/i);
  if (cm) out.heightCm = Number(cm[1]);
  else {
    const bare = s.match(/^(\d{2,3})$/);
    if (bare) { out.heightCm = Number(bare[1]); out.bareHeight = true; }
  }

  if (!out.age && out.heightCm != null) out.age = heightToAge(out.heightCm);
  return out;
}

export function translateSizeLabel(raw) {
  const original = String(raw == null ? '' : raw).trim();
  if (!original) return '';
  const parsed = parseSizeMeta(original);
  const s = normaliseSizeDash(original);

  if (parsed.adult) {
    const prefix = s.replace(/[\s-]*adult[\s-]*/i, '').trim();
    const cleaned = upperSizePrefix(prefix) || prefix;
    return cleaned ? cleaned + ' (Adult)' : 'Adult';
  }

  const age = parsed.age || '';
  const prefixMatch = s.match(/^([A-Za-z]{1,4}|\d{2,3})(?=\s*\(|\s|\d|$)/);
  const prefix = prefixMatch ? upperSizePrefix(prefixMatch[1]) : '';

  if (age) {
    if (prefix) {
      if (parsed.heightCm != null && (parsed.bareHeight || /\d\s*CM\b/i.test(s))) return parsed.heightCm + ' cm (' + age + ')';
      return prefix + ' (' + age + ')';
    }
    return age;
  }

  const withoutWeight = s
    .replace(/\bBB\s*\d{1,3}\s*[–-]\s*\d{1,3}\s*KG\b/i, '')
    .replace(/\bBB\s*\d{1,3}\s*KG\b/i, '')
    .replace(/\s*\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return upperSizePrefix(withoutWeight) || withoutWeight;
}

export function displaySize(raw, mode) {
  const original = String(raw == null ? '' : raw).trim();
  if (!original) return '';
  const m = normaliseSizeLabelMode(mode);
  if (m === 'manual') return original;
  if (m === 'height') {
    const parsed = parseSizeMeta(original);
    if (parsed.heightCm != null) return parsed.heightCm + ' cm';
  }
  return translateSizeLabel(original);
}

// True when a label still carries Indonesian size tokens (TAHUN/Thn/BB/Bulan).
export function hasIndonesianSizeTokens(raw) {
  return /(?:TAHUN|THN|BULAN|BLN|\bBB\b)/i.test(String(raw || ''));
}
