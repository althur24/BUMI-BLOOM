// Shopify sales analytics via Admin API (orders). Visitor/session counts are NOT
// exposed by the Shopify Admin API — those remain on the Shopify dashboard
// (linked from the widget). This computes revenue + order count + daily
// breakdown for the last N days.

import { adminGraphQL } from "./shopify";

export interface AnalyticsSummary {
  range: string;
  from: string; // ISO date
  totalRevenue: number;
  orderCount: number;
  currency: string;
  daily: { date: string; revenue: number; orders: number }[];
  truncated: boolean; // true if >250 orders in range (pagination not yet handled)
}

interface OrdersResponse {
  orders: {
    edges: {
      node: {
        totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
        processedAt: string;
      };
    }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

const ORDERS_QUERY = `query($first:Int!,$q:String!,$after:String){
  orders(first:$first, query:$q, after:$after){
    edges{ node{ totalPriceSet{ shopMoney{ amount currencyCode } } processedAt } }
    pageInfo{ hasNextPage endCursor }
  }
}`;

export async function getAnalyticsSummary(
  range: "7d" | "30d",
): Promise<AnalyticsSummary> {
  const days = range === "30d" ? 30 : 7;
  const since = new Date(Date.now() - days * 86_400_000);
  const sinceStr = since.toISOString().slice(0, 10); // YYYY-MM-DD

  // Exclude cancelled orders so they don't inflate revenue. Refunded (but not
  // cancelled) orders still count as gross sales — net revenue (minus refunds)
  // is a Fase 5 refinement.
  const MAX = 1000; // safety cap so a huge store doesn't paginate forever
  let cursor: string | null = null;
  let hasNext = true;
  let truncated = false;

  let totalRevenue = 0;
  let orderCount = 0;
  let currency = "AUD";
  const dailyMap: Record<string, { revenue: number; orders: number }> = {};

  while (hasNext) {
    const data = await adminGraphQL<OrdersResponse>(ORDERS_QUERY, {
      first: 250,
      q: `processed_at:>=${sinceStr} -status:cancelled`,
      after: cursor,
    });

    for (const edge of data.orders.edges) {
      const node = edge.node;
      const amount = Number(node.totalPriceSet.shopMoney.amount);
      if (!Number.isFinite(amount)) continue;
      totalRevenue += amount;
      currency = node.totalPriceSet.shopMoney.currencyCode || currency;
      orderCount++;
      const day = (node.processedAt || "").slice(0, 10);
      if (!day) continue;
      if (!dailyMap[day]) dailyMap[day] = { revenue: 0, orders: 0 };
      dailyMap[day].revenue += amount;
      dailyMap[day].orders += 1;
    }

    if (orderCount >= MAX) {
      truncated = true;
      break;
    }
    hasNext = data.orders.pageInfo.hasNextPage;
    cursor = data.orders.pageInfo.endCursor;
  }

  const daily = Object.entries(dailyMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, ...v }));

  return {
    range,
    from: sinceStr,
    totalRevenue,
    orderCount,
    currency,
    daily,
    truncated,
  };
}
