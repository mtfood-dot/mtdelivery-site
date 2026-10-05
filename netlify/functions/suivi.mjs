// Recherche publique des colis par numéro de téléphone.
// Renvoie seulement : numéro de suivi, wilaya, état et date. Rien d'autre.
import { store, normTel, json } from "./lib.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée." }, 405);
  let tel = "";
  try { tel = normTel((await req.json()).tel); } catch {}
  if (!/^0[5-7]\d{8}$/.test(tel)) return json({ ok: false, error: "numero" }, 400);

  const data = (await store().get("colis", { type: "json" })) || { items: {} };
  const found = Object.values(data.items || {})
    .filter((r) => (r.tels || []).includes(tel))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 10)
    .map(({ id, wilaya, etat, date }) => ({ id, wilaya, etat, date }));

  return json({ ok: true, colis: found, updatedAt: data.updatedAt || null });
};

export const config = { path: "/api/suivi" };
