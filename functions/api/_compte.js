// Comptes expéditeurs : identifiant = numéro de téléphone, mot de passe haché (PBKDF2-SHA256, sel aléatoire).
// Stockage KV (espace COLIS) :
//   cpt:<tel>        compte {tel, nom, boutique, sel, hash, iter, ver, actif, doitChanger, cree, maj}
//   ses:<empreinte>  session {tel, ver}, expire seule au bout de 30 jours ; le jeton brut n'est jamais stocké
//   cptdem:<tel>     identifiants des demandes envoyées depuis l'espace (50 dernières)
// « ver » change à chaque nouveau mot de passe : toutes les sessions ouvertes avant deviennent invalides.
import { normTel } from "./_lib.js";

export const ITER = 100000; // maximum accepté par Cloudflare Workers
export const SESSION_TTL = 30 * 24 * 3600;
export const COOKIE = "mt_exp";

export const telValide = (v) => { const t = normTel(v); return /^0[2-7]\d{8}$/.test(t) ? t : null; };

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const deHex = (h) => new Uint8Array((h.match(/../g) || []).map((x) => parseInt(x, 16)));

export async function hacher(mdp, selHex, iter = ITER) {
  const sel = selHex ? deHex(selHex) : crypto.getRandomValues(new Uint8Array(16));
  const cle = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(mdp)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sel, iterations: iter }, cle, 256);
  return { sel: hex(sel), hash: hex(new Uint8Array(bits)), iter };
}

export async function verifierMdp(compte, mdp) {
  if (!compte || !compte.sel || !compte.hash) return false;
  const { hash } = await hacher(mdp, compte.sel, compte.iter || ITER);
  let d = hash.length ^ compte.hash.length;
  for (let i = 0; i < Math.min(hash.length, compte.hash.length); i++) d |= hash.charCodeAt(i) ^ compte.hash.charCodeAt(i);
  return d === 0;
}

// Mot de passe provisoire lisible (sans 0/O, 1/l/I).
export function mdpProvisoire(n = 10) {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(n));
  return [...r].map((x) => a[x % a.length]).join("");
}

// Règle du mot de passe choisi par l'expéditeur.
export function mdpAcceptable(m) {
  m = String(m ?? "");
  // 8 caractères au moins, pas seulement des chiffres (ex. son numéro de téléphone), au moins 4 caractères différents.
  return m.length >= 8 && m.length <= 128 && /\D/.test(m) && new Set(m).size >= 4;
}

// Hash factice calculé quand le numéro n'a pas de compte : même durée de réponse (on ne révèle pas qui a un compte).
const FACTICE = { sel: "00112233445566778899aabbccddeeff", hash: "0".repeat(64), iter: ITER };
export const verifierFactice = (mdp) => verifierMdp(FACTICE, mdp).then(() => false);

export const lireCompte = (env, tel) => env.COLIS.get("cpt:" + tel, { type: "json" });
export const ecrireCompte = (env, c) => env.COLIS.put("cpt:" + c.tel, JSON.stringify(c));

async function empreinte(jeton) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jeton))));
}

export async function ouvrirSession(env, compte) {
  const jeton = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.COLIS.put("ses:" + (await empreinte(jeton)), JSON.stringify({ tel: compte.tel, ver: compte.ver || 1 }), { expirationTtl: SESSION_TTL });
  return jeton;
}

export async function fermerSession(env, jeton) {
  if (/^[0-9a-f]{64}$/.test(jeton || "")) await env.COLIS.delete("ses:" + (await empreinte(jeton)));
}

export function jetonCookie(request) {
  const m = /(?:^|;\s*)mt_exp=([0-9a-f]{64})(?:;|$)/.exec(request.headers.get("cookie") || "");
  return m ? m[1] : null;
}

export function cookieSession(request, jeton) {
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(request.url);
  const base = `${COOKIE}=${jeton || ""}; Path=/api/; HttpOnly; SameSite=Strict${local ? "" : "; Secure"}`;
  return jeton ? `${base}; Max-Age=${SESSION_TTL}` : `${base}; Max-Age=0`;
}

// Compte connecté (ou null) : session présente, compte actif, même version de mot de passe.
export async function compteConnecte(request, env) {
  const jeton = jetonCookie(request);
  if (!jeton) return null;
  const s = await env.COLIS.get("ses:" + (await empreinte(jeton)), { type: "json" });
  if (!s) return null;
  const c = await lireCompte(env, s.tel);
  if (!c || !c.actif || (c.ver || 1) !== s.ver) return null;
  return c;
}

// Limite d'échecs de connexion dans le cache Cloudflare (sans écriture KV), sur 15 minutes :
// 8 échecs par adresse IP, 5 par couple IP + numéro, 20 par numéro toutes IP confondues
// (seuil plus haut pour qu'un tiers ne puisse pas facilement bloquer un expéditeur en tapant de faux mots de passe).
const FENETRE = 900;
const cle = (k) => new Request("https://limite.mtdelivery.invalid/espace/" + encodeURIComponent(k));
async function lire(k) {
  if (typeof caches === "undefined") return { n: 0, debut: Date.now() };
  try {
    const r = await caches.default.match(cle(k));
    const v = r ? await r.json() : null;
    if (v && Date.now() - v.debut <= FENETRE * 1000) return v;
  } catch {}
  return { n: 0, debut: Date.now() };
}
async function noter(k, v) {
  if (typeof caches === "undefined") return;
  try {
    const reste = Math.max(1, FENETRE - Math.floor((Date.now() - v.debut) / 1000));
    await caches.default.put(cle(k), new Response(JSON.stringify({ n: v.n + 1, debut: v.debut }), {
      headers: { "content-type": "application/json", "cache-control": "max-age=" + reste },
    }));
  } catch {}
}
export async function bloque(ip, tel) {
  const [a, b, c] = await Promise.all([lire("ip:" + ip), lire("tel:" + tel), lire("it:" + ip + ":" + tel)]);
  return { bloque: a.n >= 8 || c.n >= 5 || b.n >= 20, a, b, c };
}
export async function noterEchec(ip, tel, etat) {
  await Promise.all([noter("ip:" + ip, etat.a), noter("tel:" + tel, etat.b), noter("it:" + ip + ":" + tel, etat.c)]);
}

// Date de dernière connexion, gardée à part : la connexion ne réécrit jamais le compte
// (sinon elle pourrait annuler une désactivation ou une réinitialisation faite au même moment).
export const noterConnexion = (env, tel) => env.COLIS.put("cptvu:" + tel, String(Date.now()));
