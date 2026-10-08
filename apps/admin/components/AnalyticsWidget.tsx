"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

interface Summary {
  range: string;
  from: string;
  totalRevenue: number;
  orderCount: number;
  currency: string;
  daily: { date: string; revenue: number; orders: number }[];
  truncated: boolean;
  shopifyAnalyticsUrl?: string | null;
}

function fmt(n: number, ccy: string): string {
  try {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: ccy,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${ccy}`;
  }
}

export default function AnalyticsWidget() {
  const [range, setRange] = useState<"7d" | "30d">("7d");
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      setNeedsLogin(false);
      const { data: sess } = await supabaseBrowser().auth.getSession();
      if (!sess.session) {
        if (!cancelled) setNeedsLogin(true);
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/analytics/summary?range=${range}`);
        if (res.status === 401) {
          if (!cancelled) setNeedsLogin(true);
          if (!cancelled) setLoading(false);
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          if (!res.ok) setError(json.error || `HTTP ${res.status}`);
          else setData(json);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Sales</h3>
        <div>
          <button className={`btn ${range === "7d" ? "btn--primary" : ""}`} onClick={() => setRange("7d")}>7d</button>{" "}
          <button className={`btn ${range === "30d" ? "btn--primary" : ""}`} onClick={() => setRange("30d")}>30d</button>
        </div>
      </div>

      {loading && <p className="muted" style={{ marginTop: 12 }}>Loading…</p>}
      {needsLogin && (
        <p className="muted" style={{ marginTop: 12 }}>
          <a href="/login">Sign in</a> to view analytics.
        </p>
      )}
      {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}

      {data && !loading && !error && (
        <>
          <div className="row" style={{ marginTop: 12 }}>
            <div style={{ flex: 1, minWidth: 140 }}>
              <p className="muted" style={{ margin: 0 }}>Revenue ({data.range})</p>
              <strong style={{ fontSize: 22 }}>{fmt(data.totalRevenue, data.currency)}</strong>
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <p className="muted" style={{ margin: 0 }}>Orders</p>
              <strong style={{ fontSize: 22 }}>{data.orderCount}</strong>
            </div>
          </div>

          {data.truncated && (
            <p className="muted" style={{ marginTop: 8 }}>
              &gt;250 orders in range — ringkasan terpotong (pagination TODO).
            </p>
          )}

          {data.daily.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <p className="muted" style={{ margin: "0 0 4px" }}>Daily breakdown</p>
              <div className="history">
                {data.daily.map((d) => (
                  <div className="history-item" key={d.date}>
                    <span>{d.date}</span>
                    <span>{fmt(d.revenue, data.currency)}</span>
                    <span className="muted">{d.orders} ord</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.shopifyAnalyticsUrl && (
            <p style={{ marginTop: 14 }}>
              <a href={data.shopifyAnalyticsUrl} target="_blank" rel="noreferrer">
                Buka Shopify Analytics (visitors, sessions) ↗
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
