// Reçoit les colis extraits de l'export Ecotrack (station) et les fusionne dans le stockage.
// Seuls ID, téléphones, wilaya, état et date sont gardés : jamais nom, adresse, produits ni montant.
import { store, normTel, json } from "./lib.mjs";

const KEEP_DAYS = 60;

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée." }, 405);
  const expected = process.env.ADMIN_PASSWORD || process.env.ADMIN_MT;
  if (!expected) return json({ ok: false, error: "Mot de passe admin non configuré sur Netlify (ADMIN_MT)." }, 503);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Données illisibles." }, 400); }
  if (!body || body.password !== expected) return json({ ok: false, error: "Mot de passe incorrect." }, 401);
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 20000)
    return json({ ok: false, error: "Aucun colis reçu." }, 400);

  const s = store();
  const current = (await s.get("colis", { type: "json" })) || { items: {} };
  const items = current.items || {};
  const now = Date.now();
  let added = 0, updated = 0;

  for (const r of body.rows) {
    const id = String(r.id ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,40}$/.test(id)) continue;
    const tels = [normTel(r.tel1), normTel(r.tel2)].filter((t) => /^0\d{9}$/.test(t));
    if (!tels.length) continue;
    const rec = {
      id, tels,
      wilaya: String(r.wilaya ?? "").slice(0, 60),
      etat: String(r.etat ?? "").slice(0, 80),
      date: String(r.date ?? "").slice(0, 30),
      seen: now,
    };
    if (items[id]) updated++; else added++;
    items[id] = rec;
  }

  const limit = now - KEEP_DAYS * 864e5;
  let removed = 0;
  for (const [id, rec] of Object.entries(items)) {
    if ((rec.seen || 0) < limit) { delete items[id]; removed++; }
  }

  await s.setJSON("colis", { items, updatedAt: now });
  return json({ ok: true, added, updated, removed, total: Object.keys(items).length, updatedAt: now });
};

export const config = { path: "/api/import" };
