'use client';

import { useEffect } from 'react';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[data-bbsrc="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded) resolve();
      else existing.addEventListener('load', () => resolve());
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.dataset.bbsrc = src;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => resolve();
    document.body.appendChild(s);
  });
}

export function Scripts({ srcs }: { srcs: string[] }) {
  const key = srcs.join('\n');
  useEffect(() => {
    const list = key.split('\n');
    let cancelled = false;
    (async () => {
      for (const src of list) {
        if (cancelled) return;
        await loadScript(src);
      }
    })();
    return () => { cancelled = true; };
  }, [key]);
  return null;
}
