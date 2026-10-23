// Demandes envoyées depuis le site (nouvel expéditeur, argent COD, réclamation, avis).
// POST public  {categorie, champs…}                   -> enregistre la demande (Cloudflare + Google Sheet)
// POST admin   {password, action:"list"}              -> liste des demandes
// POST admin   {password, action:"statut", id, statut} -> change le statut
// Chaque demande est une clé KV « dem:<horodatage>-<aléa> », sans risque d'écrasement entre deux envois.
// Copie dans Google Sheet : variable Cloudflare SHEET_URL (adresse de l'Apps Script), SHEET_TOKEN facultatif.
import { json, verifierSecret } from "./_lib.js";

const FIELDS = {
  expediteur: ["nom", "prenom", "adresse", "email", "tel", "boutique", "secteur"],
  cod: ["boutique", "tel", "suivis", "montant"],
  reclamation: ["nom", "tel", "suivi", "type", "desc"], // « type » = motif choisi dans le formulaire
  avis: ["prenom", "texte", "note"],
};
const STATUTS = ["nouveau", "en cours", "réglé"];
const MAX_LEN = 1500;

// Pièce d'identité (formulaire expéditeur) : fichier PDF uniquement, 5 Mo max après décodage.
// Stockée à part (clé « piece:<id> »), lisible seulement via l'action admin « piece », effacée au bout de 90 jours.
const PIECE_MAX = 5 * 1024 * 1024;
const PIECE_TTL = 30 * 24 * 3600; // 30 jours max ; effacée dès que la demande passe à « réglé »
function lirePiece(v) {
  const m = /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ""));
  if (!m) return null;
  let bin;
  try { bin = atob(m[1]); } catch { return null; }
  if (bin.length < 100 || bin.length > PIECE_MAX) return null;
  if (bin.slice(0, 5) !== "%PDF-") return null; // signature PDF
  return "data:application/pdf;base64," + m[1];
}


// Envoie la demande à l'Apps Script de la Google Sheet. Ne bloque jamais l'enregistrement.
// Copie destinée à la Google Sheet : les valeurs qui commencent par = + - @ (formules) sont préfixées d'une apostrophe
// pour rester du texte (audit V8, protection doublée dans le script Google). Les données gardées sur Cloudflare ne changent pas.
const sansFormule = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
function pourFeuille(demande) {
  const data = {};
  for (const [k, v] of Object.entries(demande.data || {})) data[k] = sansFormule(v);
  return { ...demande, data };
}

async function toSheet(env, demande) {
  if (!env.SHEET_URL) return "non configurée";
  demande = pourFeuille(demande);
  try {
    const r = await fetch(env.SHEET_URL, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: env.SHEET_TOKEN || "", demande }),
      redirect: "follow",
    });
    const j = await r.json().catch(() => ({}));
    return j.ok ? "ok" : "erreur: " + (j.error || r.status);
  } catch (e) {
    return "erreur: " + (e && e.message || e);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.COLIS) return json({ ok: false, error: "stockage" }, 503);
  let b;
  try { b = await request.json(); } catch { return json({ ok: false, error: "Données illisibles." }, 400); }
  if (!b || typeof b !== "object") return json({ ok: false, error: "Données illisibles." }, 400);

  // --- Actions admin ---
  if (b.action) {
    const refus = await verifierSecret(request, [env.ADMIN_MT || env.ADMIN_PASSWORD], b.password);
    if (refus) return refus;

    if (b.action === "list") {
      const out = [];
      let cursor;
      do {
        const page = await env.COLIS.list({ prefix: "dem:", cursor });
        const vals = await Promise.all(page.keys.map((k) => env.COLIS.get(k.name, { type: "json" })));
        vals.forEach((v) => v && out.push(v));
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      out.sort((a, b2) => (b2.date || 0) - (a.date || 0));
      return json({ ok: true, demandes: out, sheet: !!env.SHEET_URL });
    }

    if (b.action === "statut") {
      if (!/^dem:\d+-[a-z0-9]+$/.test(String(b.id)) || !STATUTS.includes(b.statut))
        return json({ ok: false, error: "Demande ou statut invalide." }, 400);
      const d = await env.COLIS.get(b.id, { type: "json" });
      if (!d) return json({ ok: false, error: "Demande introuvable." }, 404);
      d.statut = b.statut;
      d.majStatut = Date.now();
      // Pièce d'identité : l'original est gardé sur papier, la copie en ligne est effacée une fois la demande réglée.
      if (b.statut === "réglé" && d.data && d.data.piece === "oui") {
        await env.COLIS.delete("piece:" + b.id);
        d.data.piece = "effacée";
      }
      await env.COLIS.put(b.id, JSON.stringify(d));
      return json({ ok: true });
    }

    if (b.action === "piece") {
      if (!/^dem:\d+-[a-z0-9]+$/.test(String(b.id))) return json({ ok: false, error: "Demande invalide." }, 400);
      const img = await env.COLIS.get("piece:" + b.id);
      return img ? json({ ok: true, fichier: img }) : json({ ok: false, error: "Pièce introuvable ou expirée." }, 404);
    }

    if (b.action === "testSheet") {
      const res = await toSheet(env, { id: "test", type: "test", date: Date.now(), statut: "test", data: {} });
      return json({ ok: res === "ok", sheet: res });
    }
    return json({ ok: false, error: "Action inconnue." }, 400);
  }

  // --- Envoi public d'une demande ---
  const cat = b.categorie || (FIELDS[b.type] ? b.type : null);
  const fields = FIELDS[cat];
  if (!fields) return json({ ok: false, error: "Type de demande inconnu." }, 400);
  if (b.site) return json({ ok: true }); // champ piège rempli par les robots : on ignore sans le dire

  // Anti-robot Turnstile (audit V7), actif dès que le secret TURNSTILE_SECRET est défini dans Cloudflare.
  if (env.TURNSTILE_SECRET) {
    let valide = false;
    const jeton = String(b.ts || "").slice(0, 4096);
    if (jeton) {
      try {
        const f = new FormData();
        f.append("secret", env.TURNSTILE_SECRET); f.append("response", jeton);
        f.append("remoteip", request.headers.get("cf-connecting-ip") || "");
        const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f });
        valide = !!(await r.json()).success;
      } catch { valide = false; }
    }
    if (!valide) return json({ ok: false, error: "Vérification anti-robot non validée." }, 403);
  }

  // Limite simple : 5 demandes par minute et par adresse IP.
  const ip = request.headers.get("cf-connecting-ip") || "inconnu";
  const rlKey = "rl:" + ip;
  const count = +(await env.COLIS.get(rlKey)) || 0;
  if (count >= 5) return json({ ok: false, error: "Trop de demandes. Réessayez dans une minute." }, 429);
  await env.COLIS.put(rlKey, String(count + 1), { expirationTtl: 60 });

  const data = {};
  for (const f of fields) {
    if (f === "type" && !b.categorie) continue; // ancien format : « type » était la catégorie
    const v = String(b[f] ?? "").trim().slice(0, MAX_LEN);
    if (v) data[f] = v;
  }
  if (!Object.keys(data).length) return json({ ok: false, error: "Demande vide." }, 400);

  let piece = null;
  if (cat === "expediteur") {
    piece = lirePiece(b.piece);
    if (!piece) return json({ ok: false, error: "Pièce d'identité manquante ou invalide (PDF, 5 Mo max)." }, 400);
    data.piece = "oui";
  }

  const now = Date.now();
  const id = `dem:${now}-${Math.random().toString(36).slice(2, 8)}`;
  const demande = { id, type: cat, data, date: now, statut: "nouveau" };
  if (piece) await env.COLIS.put("piece:" + id, piece, { expirationTtl: PIECE_TTL });
  await env.COLIS.put(id, JSON.stringify(demande));

  // Copie dans la Google Sheet en arrière-plan (le client n'attend pas).
  const job = toSheet(env, demande);
  if (context.waitUntil) context.waitUntil(job); else await job;

  return json({ ok: true, id });
}
