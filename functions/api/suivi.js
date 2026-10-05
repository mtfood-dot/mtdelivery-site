// Recherche publique des colis par numéro de téléphone (version Cloudflare Pages).
// Renvoie seulement : numéro de suivi, wilaya, état et date.
import { normTel, json } from "./_lib.js";

export async function onRequestPost({ request, env }) {
  let tel = "";
  try { tel = normTel((await request.json()).tel); } catch {}
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
