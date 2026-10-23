// Anti-robot Cloudflare Turnstile sur les formulaires du site (audit V7).
// Inactif tant que la clé publique TURNSTILE_SITE_KEY n'est pas définie dans Cloudflare : les formulaires marchent alors comme avant.
// Utilisation : antiRobot.jeton("tsExp") avant l'envoi, antiRobot.reset("tsExp") après (un jeton ne sert qu'une fois).
(function () {
  const widgets = {}, jetons = {};
  let cle = null;
  window.antiRobot = {
    jeton: (id) => jetons[id] || "",
    reset(id) { jetons[id] = ""; if (window.turnstile && widgets[id] !== undefined) try { turnstile.reset(widgets[id]); } catch (e) {} },
  };
  function rendre() {
    document.querySelectorAll(".ts[id]").forEach((el) => {
      if (widgets[el.id] !== undefined) return;
      el.hidden = false;
      widgets[el.id] = turnstile.render(el, {
        sitekey: cle, size: "flexible", language: document.documentElement.lang === "ar" ? "ar" : "fr",
        callback: (t) => { jetons[el.id] = t; },
        "expired-callback": () => { jetons[el.id] = ""; },
        "error-callback": () => { jetons[el.id] = ""; },
      });
    });
  }
  fetch("/api/config").then((r) => r.json()).then((c) => {
    if (!c || !c.turnstile) return;
    cle = c.turnstile;
    window.onTurnstileCharge = rendre;
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileCharge";
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }).catch(() => {});
})();
