// Configuration publique du site : clé publique anti-robot Turnstile (la clé secrète reste côté serveur).
import { json } from "./_lib.js";
export const onRequestGet = ({ env }) => json({ ok: true, turnstile: env.TURNSTILE_SITE_KEY || null });
