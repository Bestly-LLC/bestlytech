// trustpilot-review — bestly.tech/review short link. GET -> 302 to Bestly's
// Trustpilot write-a-review page. No lookup needed, the target never changes.
// Pairs with trustpilot-badge (the live rating badge) and the trustpilot_reviews
// table the Pi job fills from Trustpilot's own notification emails.
const TARGET = "https://www.trustpilot.com/evaluate/bestly.tech";

Deno.serve((req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  return new Response(null, { status: 302, headers: { Location: TARGET, "Cache-Control": "no-store" } });
});
