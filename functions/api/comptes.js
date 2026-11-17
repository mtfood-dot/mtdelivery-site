// Gestion des comptes expéditeurs par l'équipe (mot de passe admin ADMIN_MT / ADMIN_PASSWORD).
// POST {password, action:"list"}                                   -> liste (sans aucune donnée de mot de passe)
// POST {password, action:"creer", tel, nom, boutique, demandeId?}  -> crée le compte, renvoie le mot de passe provisoire (une seule fois)
// POST {password, action:"reinit", tel}                            -> nouveau mot de passe provisoire, déconnecte partout
// POST {password, action:"actif", tel, actif}                      -> active / désactive (désactivé = connexion refusée)
import { json, verifierSecret } from "./_lib.js";
import { telValide, hacher, mdpProvisoire, lireCompte, ecrireCompte } from "./_compte.js";

const texte = (v, n = 80) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, n);
const publicCompte = ({ tel, nom, boutique, actif, doitChanger, cree, maj, derniere }) => ({ tel, nom, boutique, actif, doitChanger, cree, maj, derniere: derniere || null });

export async function onRequestPost({ request, env }) {
  if (!env.COLIS) return json({ ok: false, error: "stockage" }, 503);
  let b;
  try { b = await request.json(); } catch { return json({ ok: false, error: "Données illisibles." }, 400); }
  if (!b || typeof b !== "object") return json({ ok: false, error: "Données illisibles." }, 400);
  const refus = await verifierSecret(request, [env.ADMIN_MT || env.ADMIN_PASSWORD], b.password);
  if (refus) return refus;

  if (b.action === "list") {
    const out = [];
    let cursor;
    do {
      const page = await env.COLIS.list({ prefix: "cpt:", cursor });
      const vals = await Promise.all(page.keys.map((k) => env.COLIS.get(k.name, { type: "json" })));
      const vus = await Promise.all(vals.map((v) => (v ? env.COLIS.get("cptvu:" + v.tel) : null)));
      vals.forEach((v, i) => v && out.push(publicCompte({ ...v, derniere: +vus[i] || v.derniere })));
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    out.sort((x, y) => (y.cree || 0) - (x.cree || 0));
    return json({ ok: true, comptes: out });
  }

  const tel = telValide(b.tel);
  if (!tel) return json({ ok: false, error: "Numéro de téléphone invalide (10 chiffres, ex. 0550 12 34 56)." }, 400);

  if (b.action === "creer") {
    const nom = texte(b.nom), boutique = texte(b.boutique);
    if (!nom && !boutique) return json({ ok: false, error: "Indiquez au moins le nom ou la boutique." }, 400);
    if (await lireCompte(env, tel)) return json({ ok: false, error: "Un compte existe déjà pour ce numéro." }, 409);
    const mdp = mdpProvisoire();
    const h = await hacher(mdp);
    const now = Date.now();
    const c = { tel, nom, boutique, ...h, ver: 1, actif: true, doitChanger: true, cree: now, maj: now };
    if (/^dem:\d+-[a-z0-9]+$/.test(String(b.demandeId || ""))) c.demande = b.demandeId;
    await ecrireCompte(env, c);
    return json({ ok: true, compte: publicCompte(c), mdp });
  }

  const c = await lireCompte(env, tel);
  if (!c) return json({ ok: false, error: "Compte introuvable." }, 404);

  if (b.action === "reinit") {
    const mdp = mdpProvisoire();
    Object.assign(c, await hacher(mdp), { ver: (c.ver || 1) + 1, doitChanger: true, maj: Date.now() });
    await ecrireCompte(env, c);
    return json({ ok: true, compte: publicCompte(c), mdp });
  }

  if (b.action === "actif") {
    c.actif = b.actif !== false;
    c.maj = Date.now();
    if (!c.actif) c.ver = (c.ver || 1) + 1; // déconnexion immédiate
    await ecrireCompte(env, c);
    return json({ ok: true, compte: publicCompte(c) });
  }

  return json({ ok: false, error: "Action inconnue." }, 400);
}
