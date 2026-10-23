// Fichiers internes du dépôt jamais servis en ligne (audit V11). Les autres requêtes passent normalement.
// _routes.json limite l'exécution de ce code à /api/* et à ces fichiers (les pages restent servies sans fonction).
const INTERNES = /^\/(README\.md|package\.json|netlify\.toml|_headers|_routes\.json|\.gitignore|apps-script\/.*|netlify\/.*|functions\/.*)$/i;
export async function onRequest({ request, next }) {
  if (INTERNES.test(new URL(request.url).pathname)) return new Response("Introuvable", { status: 404 });
  return next();
}
