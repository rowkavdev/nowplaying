// Serves the browser-based first-run wizard. The page is static; all state goes
// through /api/setup/draft. Served with page: true so the loopback server applies
// PAGE_CSP (same-origin script/style only, no inline code).

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NowPlaying setup</title>
<link rel="stylesheet" href="/setup/app.css">
<script src="/setup/app.js" defer></script>
</head>
<body>
<main>
<h1>NowPlaying setup</h1>
<ol id="steps" aria-label="Setup steps"></ol>
<section id="panel" aria-live="polite"><p>Loading...</p></section>
<p id="error" role="alert" hidden></p>
<nav>
<button type="button" id="back">Back</button>
<button type="button" id="next">Next</button>
<button type="button" id="reset" class="link">Start over</button>
</nav>
</main>
</body>
</html>
`;

const CSS = `body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#111;color:#eee}
main{max-width:34rem;margin:3rem auto;padding:0 1rem}
h1{font-size:1.5rem}
ol{display:flex;gap:.75rem;padding:0;list-style:none;font-size:.85rem;color:#888}
ol li[aria-current=step]{color:#fff;font-weight:600}
label{display:block;margin:.5rem 0}
select{font:inherit}
nav{display:flex;gap:.5rem;margin-top:2rem}
button{font:inherit;padding:.5rem 1rem;border-radius:.4rem;border:1px solid #555;background:#222;color:#eee;cursor:pointer}
button#next{background:#3b6;border-color:#3b6;color:#000}
button.link{margin-left:auto;background:none;border:none;text-decoration:underline}
button:disabled{opacity:.5;cursor:default}
#error{color:#f77}
`;

const JS = `"use strict";
(function () {
  var API = "/api/setup/draft";
  var STEPS = ["welcome", "provider", "discord", "review", "complete"];
  var LABELS = { welcome: "Welcome", provider: "Media server", discord: "Discord", review: "Review", complete: "Done" };
  var PROVIDERS = [["plex", "Plex"], ["jellyfin", "Jellyfin"], ["emby", "Emby"], ["navidrome", "Navidrome"]];
  var IDLE = [["clear", "Clear my status"], ["grace", "Keep it for a short grace period"], ["show", "Show that nothing is playing"], ["recent", "Show what I played last"]];
  var draft = null;
  var busy = false;

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) { node[key] = props[key]; });
    (children || []).forEach(function (child) { node.append(child); });
    return node;
  }

  function request(method, body) {
    var init = { method: method, headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store" };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(API, init).then(function (response) {
      if (!response.ok) throw new Error("Request failed (" + response.status + ")");
      return response.json();
    });
  }

  function send(method, body) {
    if (busy) return;
    busy = true;
    showError("");
    render();
    request(method, body).then(function (result) { draft = result.draft; })
      .catch(function () { showError("Couldn't save that step. Check NowPlaying is still running and try again."); })
      .then(function () { busy = false; render(); });
  }

  function showError(text) {
    var node = document.getElementById("error");
    node.textContent = text;
    node.hidden = !text;
  }

  function changes() {
    var result = {};
    var picked = document.querySelector("input[name=provider]:checked");
    if (picked) result.provider = picked.value;
    var enabled = document.getElementById("discordEnabled");
    if (enabled) result.discordEnabled = enabled.checked;
    var idle = document.getElementById("discordIdleBehavior");
    if (idle) result.discordIdleBehavior = idle.value;
    return result;
  }

  function nameOf(list, value) {
    var match = list.filter(function (item) { return item[0] === value; })[0];
    return match ? match[1] : "Not chosen";
  }

  function panel() {
    switch (draft.step) {
      case "welcome":
        return [el("h2", { textContent: "Show what you're playing on Discord" }), el("p", { textContent: "This takes about a minute. Your progress is saved on this PC, so you can close this page and come back." })];
      case "provider":
        return [el("h2", { textContent: "Which media server do you use?" })].concat(PROVIDERS.map(function (item) {
          return el("label", {}, [el("input", { type: "radio", name: "provider", value: item[0], checked: draft.provider === item[0] }), " " + item[1]]);
        }));
      case "discord":
        return [
          el("h2", { textContent: "Discord status" }),
          el("label", {}, [el("input", { type: "checkbox", id: "discordEnabled", checked: draft.discordEnabled }), " Show what I'm playing on Discord"]),
          el("label", { htmlFor: "discordIdleBehavior" }, ["When nothing is playing: "]),
          el("select", { id: "discordIdleBehavior" }, IDLE.map(function (item) { return el("option", { value: item[0], textContent: item[1], selected: draft.discordIdleBehavior === item[0] }); })),
        ];
      case "review":
        return [
          el("h2", { textContent: "Check your choices" }),
          el("p", { textContent: "Media server: " + nameOf(PROVIDERS, draft.provider) }),
          el("p", { textContent: "Discord status: " + (draft.discordEnabled ? "On" : "Off") + " - when idle: " + nameOf(IDLE, draft.discordIdleBehavior) }),
        ];
      default:
        return [el("h2", { textContent: "All set" }), el("p", { textContent: "Your choices are saved. Next you'll connect your " + nameOf(PROVIDERS, draft.provider) + " account." })];
    }
  }

  function render() {
    if (!draft) return;
    var index = STEPS.indexOf(draft.step);
    document.getElementById("steps").replaceChildren.apply(document.getElementById("steps"), STEPS.map(function (step, i) {
      var item = el("li", { textContent: LABELS[step] });
      if (i === index) item.setAttribute("aria-current", "step");
      return item;
    }));
    var body = document.getElementById("panel");
    body.replaceChildren.apply(body, panel());
    var needsProvider = draft.step === "provider" && !document.querySelector("input[name=provider]:checked");
    document.getElementById("back").disabled = busy || index <= 0;
    document.getElementById("next").disabled = busy || index >= STEPS.length - 1 || needsProvider;
    document.getElementById("next").textContent = draft.step === "review" ? "Finish" : "Next";
    document.getElementById("reset").disabled = busy;
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("panel").addEventListener("change", function () {
      if (draft && draft.step === "provider") document.getElementById("next").disabled = busy || !document.querySelector("input[name=provider]:checked");
    });
    document.getElementById("next").addEventListener("click", function () { send("POST", { action: "next", changes: changes() }); });
    document.getElementById("back").addEventListener("click", function () { send("POST", { action: "back", changes: changes() }); });
    document.getElementById("reset").addEventListener("click", function () { send("DELETE"); });
    request("GET").then(function (result) { draft = result.draft; render(); })
      .catch(function () { showError("Couldn't reach NowPlaying. Make sure it is running, then reload this page."); });
  });
})();
`;

const ASSETS = Object.freeze({
  "/setup": { type: "text/html; charset=utf-8", body: HTML, page: true },
  "/setup/app.js": { type: "text/javascript; charset=utf-8", body: JS },
  "/setup/app.css": { type: "text/css; charset=utf-8", body: CSS },
});

export function createSetupPageHandler() {
  return async function handle(request = {}) {
    const url = new URL(request.url || "/", "http://localhost");
    const asset = Object.hasOwn(ASSETS, url.pathname) ? ASSETS[url.pathname] : null;
    if (!asset) return null;
    const method = request.method || "GET";
    if (method !== "GET" && method !== "HEAD") {
      return Object.freeze({ status: 405, headers: Object.freeze({ Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }), body: "Method Not Allowed" });
    }
    return Object.freeze({
      status: 200,
      ...(asset.page ? { page: true } : {}),
      headers: Object.freeze({ "Content-Type": asset.type }),
      body: method === "HEAD" ? "" : asset.body,
    });
  };
}
