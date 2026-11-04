const shop = process.env.SHOPIFY_SHOP;
const clientId = process.env.SHOPIFY_CLIENT_ID;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
const version = process.env.SHOPIFY_API_VERSION || "2026-10";

const NEEDED = {
  draftOrders: "read_draft_orders",
  draftOrderCreate: "write_draft_orders",
  codeDiscountNodeByCode: "read_discounts",
};

const tokenRes = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
});
const tokenJson = await tokenRes.json();
if (!tokenRes.ok) { console.log("token error", tokenRes.status, JSON.stringify(tokenJson)); process.exit(1); }

async function gql(query, variables) {
  const res = await fetch(`https://${shop}.myshopify.com/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": tokenJson.access_token },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const scopesRes = await gql(`{ currentAppInstallation { accessScopes { handle } } }`);
const scopes = (scopesRes.data?.currentAppInstallation?.accessScopes || []).map((s) => s.handle);

console.log("=== access scopes (" + scopes.length + ") ===");
["read_discounts","read_draft_orders","write_draft_orders","write_orders"].forEach((n) => {
  console.log("  " + (scopes.includes(n) ? "OK      " : "MISSING ") + n);
});

console.log("\n=== live capability probes ===");
const probeDraft = await gql(`{ draftOrders(first:1){ edges{ node{ id } } } }`);
console.log("draftOrders:", probeDraft.errors ? "DENIED" : "OK");
const probeDiscount = await gql(`query($c:String!){ codeDiscountNodeByCode(code:$c){ id } }`, { c: "WELCOME10" });
console.log("codeDiscountNodeByCode:", probeDiscount.errors ? "DENIED" : "OK");

const ready = ["read_discounts","read_draft_orders","write_draft_orders","write_orders"].every((n) => scopes.includes(n))
  && !probeDraft.errors && !probeDiscount.errors;
console.log("\nRESULT:", ready ? "READY — checkout can create orders" : "NOT READY");
process.exit(ready ? 0 : 1);
