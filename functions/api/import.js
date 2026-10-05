// Reçoit les colis extraits de l'export Ecotrack (station) et les fusionne dans KV.
// Seuls ID, téléphones, wilaya, état et date sont gardés : jamais nom, adresse, produits ni montant.
import { normTel, json } from "./_lib.js";

const KEEP_DAYS = 60;

export async function onRequestPost({ request, env }) {
  const expected = env.ADMIN_MT || env.ADMIN_PASSWORD;
  if (!expected) return json({ ok: false, error: "Mot de passe admin non configuré sur Cloudflare (ADMIN_MT)." }, 503);
  if (!env.COLIS) return json({ ok: false, error: "Stockage COLIS non relié au projet Cloudflare." }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Données illisibles." }, 400); }
  if (!body || body.password !== expected) return json({ ok: false, error: "Mot de passe incorrect." }, 401);
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 20000)
    return json({ ok: false, error: "Aucun colis reçu." }, 400);

  const current = (await env.COLIS.get("colis", { type: "json" })) || { items: {} };
  const items = current.items || {};
  const now = Date.now();
  let added = 0, updated = 0;

  for (const r of body.rows) {
    const id = String(r.id ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,40}$/.test(id)) continue;
    const tels = [normTel(r.tel1), normTel(r.tel2)].filter((t) => /^0\d{9}$/.test(t));
    if (!tels.length) continue;
    if (items[id]) updated++; else added++;
    items[id] = {
      id, tels,
      wilaya: String(r.wilaya ?? "").slice(0, 60),
      etat: String(r.etat ?? "").slice(0, 80),
      date: String(r.date ?? "").slice(0, 30),
      seen: now,
    };
  }

  const limit = now - KEEP_DAYS * 864e5;
  let removed = 0;
  for (const [id, rec] of Object.entries(items)) {
    if ((rec.seen || 0) < limit) { delete items[id]; removed++; }
  }

  await env.COLIS.put("colis", JSON.stringify({ items, updatedAt: now }));
  return json({ ok: true, added, updated, removed, total: Object.keys(items).length, updatedAt: now });
}
