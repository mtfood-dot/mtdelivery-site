// E-mails de notification à l'équipe MT Delivery (service client) pour chaque demande reçue sur le site, via l'API Brevo.
// Variables Cloudflare (projet mtdelivery) : BREVO_API_KEY (Secret), NOTIF_EMAILS (Texte, destinataires séparés par des virgules),
// NOTIF_FROM (Texte, expéditeur validé dans Brevo). Sans ces variables, rien n'est envoyé.
// La pièce d'identité n'est jamais jointe : l'e-mail indique seulement qu'elle a été reçue.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");

const TITRES = { expediteur: "Nouvel expéditeur", cod: "Demande d'argent COD", reclamation: "Réclamation", avis: "Nouvel avis client", livreur: "Candidature livreur" };
const LABELS = { nom: "Nom", prenom: "Prénom", adresse: "Adresse", email: "E-mail", tel: "Téléphone", boutique: "Boutique", secteur: "Secteur",
  suivis: "N° de suivi", montant: "Montant (DA)", suivi: "N° de suivi", type: "Motif", desc: "Description", texte: "Avis", note: "Note",
  piece: "Pièce d'identité", commune: "Commune", zones: "Zones de travail", vehicule: "Véhicule", dispo: "Disponibilité", message: "Message" };

export async function notifierDemande(env, request, demande) {
  if (!(env.BREVO_API_KEY && env.NOTIF_EMAILS && env.NOTIF_FROM)) return false;
  const dest = String(env.NOTIF_EMAILS).split(/[,;\s]+/).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10);
  if (!dest.length) return false;
  const titre = TITRES[demande.type] || "Nouvelle demande";
  const d = demande.data || {};
  const lignes = Object.entries(d).map(([k, v]) => [LABELS[k] || k, k === "piece" ? "reçue (à consulter dans la page admin)" : k === "note" ? "★".repeat(+v || 0) + ` (${v}/5)` : v]);
  const qui = d.nom || d.boutique || d.prenom || "";
  const admin = new URL(request.url).origin + "/admin.html";
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0d1b30;max-width:560px">
  <div style="background:#0a2647;color:#f2b51c;font-weight:bold;padding:12px 16px;border-radius:10px 10px 0 0">MT Delivery · ${esc(titre)}</div>
  <div style="border:1px solid #d9e0eb;border-top:0;border-radius:0 0 10px 10px;padding:16px">
  <table style="border-collapse:collapse;width:100%">${lignes.map(([k, v]) => `<tr><td style="padding:6px 8px;color:#5a6a82;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 8px;white-space:pre-wrap">${esc(v)}</td></tr>`).join("")}</table>
  <p style="margin:16px 0 0"><a href="${esc(admin)}" style="background:#f2b51c;color:#0a2647;text-decoration:none;font-weight:bold;padding:10px 16px;border-radius:8px;display:inline-block">Ouvrir la page admin</a></p>
  <p style="margin:12px 0 0;color:#5a6a82;font-size:12px">Demande ${esc(String(demande.id).replace("dem:", ""))}</p></div></div>`;
  const texte = [titre, "", ...lignes.map(([k, v]) => `${k} : ${v}`), "", "Page admin : " + admin].join("\n");
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: "Site MT Delivery", email: env.NOTIF_FROM }, to: dest.map((email) => ({ email })),
        subject: (titre + (qui ? " : " + qui : "")).slice(0, 150), htmlContent: html, textContent: texte }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error("notification e-mail refusée :", r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) {
    console.error("notification e-mail impossible :", e && e.message);
    return false;
  }
}
