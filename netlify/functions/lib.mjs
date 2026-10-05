// Utilitaires partagés : normalisation des téléphones et accès au stockage.
import { getStore } from "@netlify/blobs";

export const store = () => getStore({ name: "suivi-colis", consistency: "strong" });

// "0791 23 45 67", "+213 791234567", "213791234567" -> "0791234567"
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
