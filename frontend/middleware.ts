import { blockReason } from "./geoblock.js";

/**
 * Vercel Edge Middleware: runs before every page request on production and answers 451 for
 * visitors from the jurisdictions in geoblock.ts. Preview deployments are exempt so the game can
 * be tested from anywhere. Vercel sets the geolocation headers; a client cannot forge them.
 */
export const config = {
  matcher: ["/((?!terms\\.html|fomo-mark\\.svg).*)"],
};

export default function middleware(request: Request): Response | undefined {
  if (process.env.VERCEL_ENV !== "production") return undefined;
  const country = request.headers.get("x-vercel-ip-country");
  const reason = blockReason(country);
  if (!reason) return undefined;
  return new Response(blockedPage(country ?? "your location", reason), {
    status: 451,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function blockedPage(country: string, reason: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not available here</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#10100f;color:#f1ede4;font:16px/1.5 ui-monospace,Menlo,monospace}main{max-width:36rem;padding:2rem}h1{font-size:2rem;margin:0 0 1rem;color:#d7f36b}a{color:#d7f36b}small{color:#9a968c}</style></head>
<body><main><h1>Not available in ${country}.</h1><p>This game is a pay-to-play game with a prize pool and is not offered in ${reason === "sanctioned" ? "sanctioned" : "this"} jurisdiction. See the <a href="/terms.html">terms</a>.</p><small>HTTP 451. The contract itself lives on the Miden network and is not affected by this page.</small></main></body></html>`;
}
