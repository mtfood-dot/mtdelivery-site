// Utilitaires partagés (version Cloudflare Pages). Stockage : espace KV lié sous le nom COLIS.
export function normTel(v) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("213")) d = d.slice(3);
  if (d.length === 9) d = "0" + d;
  return d;
}
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// ---------- Protection des accès admin (audit V1) ----------
// Comparaison en temps constant (empreintes SHA-256) : ne révèle pas la longueur ni le début du mot de passe.
async function empreinte(s) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s ?? ""))));
}
async function egal(a, b) {
  const [x, y] = await Promise.all([empreinte(a), empreinte(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

// Compteur d'échecs par adresse IP dans le cache Cloudflare (aucune écriture KV).
// 5 mauvais mots de passe en 15 minutes → blocage de cette IP pendant le reste des 15 minutes.
const MAX_ECHECS = 5, FENETRE = 900;
const cleEchecs = (ip) => new Request("https://limite.mtdelivery.invalid/admin/" + encodeURIComponent(ip));
async function lireEchecs(ip) {
  if (!ip || typeof caches === "undefined") return { n: 0, debut: Date.now() };
  try {
    const r = await caches.default.match(cleEchecs(ip));
    const v = r ? await r.json() : null;
    if (v && Date.now() - v.debut <= FENETRE * 1000) return v;
  } catch {}
  return { n: 0, debut: Date.now() };
}
async function noterEchec(ip, v) {
  if (!ip || typeof caches === "undefined") return;
  try {
    const reste = Math.max(1, FENETRE - Math.floor((Date.now() - v.debut) / 1000));
    await caches.default.put(cleEchecs(ip), new Response(JSON.stringify({ n: v.n + 1, debut: v.debut }), {
      headers: { "content-type": "application/json", "cache-control": "max-age=" + reste },
    }));
  } catch {}
}

// Vérifie un mot de passe contre une liste de secrets acceptés (variables Cloudflare).
// Renvoie null si c'est bon, sinon la réponse d'erreur à renvoyer (401 ou 429).
export async function verifierSecret(request, secrets, pw) {
  const attendus = secrets.filter((s) => typeof s === "string" && s.length > 0);
  if (!attendus.length) return json({ ok: false, error: "Mot de passe admin non configuré sur Cloudflare (ADMIN_MT)." }, 503);
  const ip = request.headers.get("cf-connecting-ip") || "";
  const v = await lireEchecs(ip);
  if (v.n >= MAX_ECHECS) return json({ ok: false, error: "Trop de mots de passe incorrects. Réessayez dans 15 minutes." }, 429);
  for (const s of attendus) if (await egal(pw, s)) return null;
  await noterEchec(ip, v);
  return json({ ok: false, error: "Mot de passe incorrect." }, 401);
}
