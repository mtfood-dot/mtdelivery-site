// Utilitaires partagés (version Cloudflare Pages). Stockage : espace KV lié sous le nom COLIS.
export function normTel(v) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("213")) d = d.slice(3);
  if (d.length === 9) d = "0" + d;
  return d;
}
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
