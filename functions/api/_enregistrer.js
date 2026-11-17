// Enregistrement d'une demande (formulaires du site et espace expéditeur) : Cloudflare KV + Google Sheet + e-mail à l'équipe.
import { notifierDemande } from "./_notif.js";

// Copie destinée à la Google Sheet : les valeurs qui commencent par = + - @ (formules) sont préfixées d'une apostrophe
// pour rester du texte (audit V8, protection doublée dans le script Google). Les données gardées sur Cloudflare ne changent pas.
const sansFormule = (v) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? "'" + v : v);
function pourFeuille(demande) {
  const data = {};
  for (const [k, v] of Object.entries(demande.data || {})) data[k] = sansFormule(v);
  return { ...demande, data };
}

// Envoie la demande à l'Apps Script de la Google Sheet. Ne bloque jamais l'enregistrement.
export async function toSheet(env, demande) {
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

export const nouvelId = () => `dem:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Enregistre la demande dans KV, puis copie Google Sheet et e-mail en arrière-plan (l'expéditeur n'attend pas).
export async function enregistrer(context, demande) {
  const { request, env } = context;
  await env.COLIS.put(demande.id, JSON.stringify(demande));
  const job = Promise.all([toSheet(env, demande), notifierDemande(env, request, demande).catch(() => false)]);
  if (context.waitUntil) context.waitUntil(job); else await job;
}
