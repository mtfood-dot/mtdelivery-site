// Espace expéditeur (page /espace.html). Session dans un cookie HttpOnly « mt_exp ».
// GET                                              -> compte connecté {tel, nom, boutique, doitChanger} ou 401
// POST {action:"connexion", tel, mdp}              -> ouvre la session
// POST {action:"deconnexion"}
// POST {action:"mdp", ancien, nouveau}             -> change le mot de passe (obligatoire à la 1re connexion)
// POST {action:"demande", categorie:"cod"|"reclamation", …champs}
// POST {action:"demandes"}                         -> demandes envoyées depuis l'espace, avec leur statut
import { json } from "./_lib.js";
import { enregistrer, nouvelId } from "./_enregistrer.js";
import {
  telValide, hacher, verifierMdp, verifierFactice, noterConnexion, mdpAcceptable, lireCompte, ecrireCompte,
  ouvrirSession, fermerSession, jetonCookie, cookieSession, compteConnecte, bloque, noterEchec,
} from "./_compte.js";

const MOI = (c) => ({ tel: c.tel, nom: c.nom || "", boutique: c.boutique || "", doitChanger: !!c.doitChanger });
const MAX_LEN = 1500;
const CHAMPS = { cod: ["suivis", "montant"], reclamation: ["suivi", "type", "desc"] };
const OBLIG = { cod: ["suivis"], reclamation: ["type", "desc"] };

function avecCookie(rep, cookie) {
  rep.headers.append("set-cookie", cookie);
  return rep;
}

// Refuse les appels venant d'un autre site (le cookie est déjà SameSite=Strict ; double protection).
function autreOrigine(request) {
  const o = request.headers.get("origin");
  if (!o) return false;
  try { return new URL(o).host !== new URL(request.url).host; } catch { return true; }
}

export async function onRequestGet({ request, env }) {
  if (!env.COLIS) return json({ ok: false, error: "stockage" }, 503);
  const c = await compteConnecte(request, env);
  return c ? json({ ok: true, compte: MOI(c) }) : json({ ok: false, error: "connexion" }, 401);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.COLIS) return json({ ok: false, error: "stockage" }, 503);
  if (autreOrigine(request)) return json({ ok: false, error: "Origine refusée." }, 403);
  let b;
  try { b = await request.json(); } catch { return json({ ok: false, error: "Données illisibles." }, 400); }
  if (!b || typeof b !== "object") return json({ ok: false, error: "Données illisibles." }, 400);

  if (b.action === "connexion") {
    const tel = telValide(b.tel);
    const ip = request.headers.get("cf-connecting-ip") || "local";
    const etat = await bloque(ip, tel || "x");
    if (etat.bloque) return json({ ok: false, error: "trop" }, 429);
    const c = tel ? await lireCompte(env, tel) : null;
    // Même réponse que le numéro existe ou non (on ne révèle pas qui a un compte).
    const mdp = String(b.mdp ?? "").slice(0, 128);
    if (!(c ? await verifierMdp(c, mdp) : await verifierFactice(mdp))) {
      await noterEchec(ip, tel || "x", etat);
      return json({ ok: false, error: "identifiants" }, 401);
    }
    if (!c.actif) return json({ ok: false, error: "desactive" }, 403);
    await noterConnexion(env, c.tel);
    const jeton = await ouvrirSession(env, c);
    return avecCookie(json({ ok: true, compte: MOI(c) }), cookieSession(request, jeton));
  }

  if (b.action === "deconnexion") {
    await fermerSession(env, jetonCookie(request));
    return avecCookie(json({ ok: true }), cookieSession(request, null));
  }

  const c = await compteConnecte(request, env);
  if (!c) return avecCookie(json({ ok: false, error: "connexion" }, 401), cookieSession(request, null));

  if (b.action === "mdp") {
    if (!(await verifierMdp(c, String(b.ancien ?? "").slice(0, 128)))) return json({ ok: false, error: "ancien" }, 400);
    const nouveau = String(b.nouveau ?? "");
    if (!mdpAcceptable(nouveau)) return json({ ok: false, error: "faible" }, 400);
    if (nouveau === String(b.ancien)) return json({ ok: false, error: "identique" }, 400);
    Object.assign(c, await hacher(nouveau), { ver: (c.ver || 1) + 1, doitChanger: false, maj: Date.now() });
    await ecrireCompte(env, c);
    // Nouvelle session (les anciennes, y compris celle-ci, sont invalidées par la nouvelle version).
    const jeton = await ouvrirSession(env, c);
    return avecCookie(json({ ok: true, compte: MOI(c) }), cookieSession(request, jeton));
  }

  if (c.doitChanger) return json({ ok: false, error: "changer" }, 403);

  if (b.action === "demandes") {
    const ids = (await env.COLIS.get("cptdem:" + c.tel, { type: "json" })) || [];
    const vals = await Promise.all(ids.map((id) => env.COLIS.get(id, { type: "json" })));
    const demandes = vals.filter((d) => d && d.data && d.data.compte === c.tel)
      .map((d) => ({ id: d.id, type: d.type, date: d.date, statut: d.statut, data: Object.fromEntries(CHAMPS[d.type]?.map((k) => [k, d.data[k] || ""]) || []) }));
    return json({ ok: true, demandes });
  }

  if (b.action === "demande") {
    const cat = b.categorie;
    if (!CHAMPS[cat]) return json({ ok: false, error: "Type de demande inconnu." }, 400);
    // Limite : 10 demandes par heure et par compte.
    const rl = "rlcpt:" + c.tel;
    const n = +(await env.COLIS.get(rl)) || 0;
    if (n >= 10) return json({ ok: false, error: "trop" }, 429);
    const data = {};
    for (const f of CHAMPS[cat]) {
      const v = String(b[f] ?? "").trim().slice(0, MAX_LEN);
      if (v) data[f] = v;
    }
    if (OBLIG[cat].some((f) => !data[f])) return json({ ok: false, error: "incomplet" }, 400);
    if (data.montant && !/^\d{1,9}$/.test(data.montant)) return json({ ok: false, error: "montant" }, 400);
    // Identité reprise du compte (pas de saisie possible) : l'équipe sait qui écrit.
    Object.assign(data, { compte: c.tel, tel: c.tel, boutique: c.boutique || "", nom: c.nom || "" });
    if (cat === "cod") delete data.nom;
    const demande = { id: nouvelId(), type: cat, data, date: Date.now(), statut: "nouveau", source: "espace" };
    await env.COLIS.put(rl, String(n + 1), { expirationTtl: 3600 });
    await enregistrer(context, demande);
    const ids = (await env.COLIS.get("cptdem:" + c.tel, { type: "json" })) || [];
    await env.COLIS.put("cptdem:" + c.tel, JSON.stringify([demande.id, ...ids].slice(0, 50)));
    return json({ ok: true, id: demande.id });
  }

  return json({ ok: false, error: "Action inconnue." }, 400);
}
