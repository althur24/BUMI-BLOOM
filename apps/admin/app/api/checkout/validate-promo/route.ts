import {
  CheckoutError,
  corsHeaders,
  getClientIp,
  isRateLimited,
  jsonWithCors,
} from "@/lib/checkout";
import { prepareCheckout } from "@/lib/checkout-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const respond = (body: unknown, status: number) =>
    jsonWithCors(body, status, {}, request);

  const ip = getClientIp(request);
  if (isRateLimited(`promo:${ip}`, 40, 60_000)) {
    return respond(
      { error: "Too many attempts. Please try again shortly." },
      429,
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Invalid request body." }, 400);
  }

  try {
    const prepared = await prepareCheckout(body);
    return respond(
      {
        ok: true,
        quote: prepared.quote,
        cartHash: prepared.cartHash,
        promo: prepared.quote.promo || null,
      },
      200,
    );
  } catch (err: any) {
    if (err instanceof CheckoutError) {
      return respond({ error: err.message }, err.status);
    }
    console.error("[checkout] validate promo failed", err);
    return respond(
      { error: "We couldn't validate that code. Please try again." },
      500,
    );
  }
}
