// Recherche publique des colis par numéro de téléphone (version Cloudflare Pages).
// Renvoie seulement : numéro de suivi, wilaya, état et date.
// Protection contre l'énumération (audit V2) : 10 recherches par 10 minutes et par adresse IP.
// Le compteur utilise le cache Cloudflare (aucune écriture KV, donc pas de quota consommé) ; il est propre à chaque
// centre de données : c'est un frein, pas une garantie absolue (voir l'audit pour la protection complète).
import { normTel, json } from "./_lib.js";

const MAX = 10, FENETRE = 600; // secondes

async function limite(request) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip || typeof caches === "undefined") return false;
  try {
    const cle = new Request("https://limite.mtdelivery.invalid/suivi/" + encodeURIComponent(ip));
    const prec = await caches.default.match(cle);
    let n = 0, debut = Date.now();
    if (prec) { const v = await prec.json(); n = v.n || 0; debut = v.debut || debut; }
    if (Date.now() - debut > FENETRE * 1000) { n = 0; debut = Date.now(); }
    if (n >= MAX) return true;
    const reste = Math.max(1, FENETRE - Math.floor((Date.now() - debut) / 1000));
    await caches.default.put(cle, new Response(JSON.stringify({ n: n + 1, debut }), {
      headers: { "content-type": "application/json", "cache-control": "max-age=" + reste },
    }));
  } catch { /* en cas d'erreur du cache, la recherche reste possible */ }
  return false;
}

export async function onRequestPost({ request, env }) {
  if (await limite(request)) return json({ ok: false, error: "trop" }, 429);
  let body = {};
  try { body = await request.json(); } catch {}
  // Plusieurs numéros de suivi (25 au maximum) : état connu de chaque colis présent dans la liste importée.
  if (Array.isArray(body.nums)) {
    const nums = [...new Set(body.nums.map((x) => String(x || "").trim().toUpperCase()).filter((x) => /^[A-Z0-9-]{4,40}$/.test(x)))].slice(0, 25);
    if (!nums.length) return json({ ok: false, error: "numero" }, 400);
    if (!env.COLIS) return json({ ok: false, error: "stockage" }, 503);
    const data = (await env.COLIS.get("colis", { type: "json" })) || { items: {} };
    const colis = nums.map((n) => { const r = (data.items || {})[n]; return r ? { id: r.id, wilaya: r.wilaya, etat: r.etat, date: r.date } : { id: n, inconnu: true }; });
    return json({ ok: true, colis, updatedAt: data.updatedAt || null });
  }
  const tel = normTel(body.tel);
  if (!/^0[5-7]\d{8}$/.test(tel)) return json({ ok: false, error: "numero" }, 400);
  if (!env.COLIS) return json({ ok: false, error: "stockage" }, 503);

  const data = (await env.COLIS.get("colis", { type: "json" })) || { items: {} };
  const colis = Object.values(data.items || {})
    .filter((r) => (r.tels || []).includes(tel))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 10)
    .map(({ id, wilaya, etat, date }) => ({ id, wilaya, etat, date }));
  return json({ ok: true, colis, updatedAt: data.updatedAt || null });
}
