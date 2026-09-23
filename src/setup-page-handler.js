// Serves the browser-based first-run wizard. The page is static; all state goes
// through /api/setup/draft, and sign-in through /api/setup/signin (which never
// returns a secret). Served with page: true so the loopback server applies
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
  var SIGNIN_API = "/api/setup/signin";
  var TEST_API = "/api/setup/test";
  var TEST_MESSAGES = {
    connected: "Connected. NowPlaying can see what you're playing.",
    authentication_failed: "Your server rejected the saved sign-in. Sign in again.",
    unreachable: "Couldn't reach your server. Check the address and that the server is running.",
    connection_failed: "Your server answered, but not in a way NowPlaying understands. Check the address points at your media server.",
    missing_server: "Add your server address, then sign in again.",
    credential_unavailable: "Your saved sign-in is missing from Windows Credential Manager. Sign in again.",
    invalid_configuration: "The saved details look wrong. Sign in again.",
    not_signed_in: "Sign in first, then test the connection.",
    too_many_tests: "Too many tests in a row. Wait a few seconds and try again.",
    user_mismatch: "Your server says this sign-in belongs to a different user. Sign in again with the account you play on."
  };
  var connectionTest = null;
  var STEPS = ["welcome", "provider", "signin", "discord", "review", "complete"];
  var LABELS = { welcome: "Welcome", provider: "Media server", signin: "Sign in", discord: "Discord", review: "Review", complete: "Done" };
  var DEFAULT_URLS = { plex: "http://127.0.0.1:32400", jellyfin: "http://127.0.0.1:8096", emby: "http://127.0.0.1:8096", navidrome: "http://127.0.0.1:4533" };
  var SIGNIN_ERRORS = {
    authentication_failed: "That username or password didn't work.",
    invalid_server_url: "Enter the server address, like http://127.0.0.1:8096.",
    unreachable: "Couldn't reach that server. Check the address and that the server is running.",
    quick_connect_disabled: "Quick Connect is turned off on this Jellyfin server. Turn it on in the Jellyfin dashboard and try again.",
    expired: "That sign-in expired. Start again.",
    too_many_signins: "Too many sign-ins are open. Wait a minute and try again.",
  };
  var signin = { flowId: null, code: null, timer: null };
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

  function callSignIn(body) {
    var init = { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body) };
    return fetch(SIGNIN_API, init).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (result) {
        if (!response.ok) throw new Error(SIGNIN_ERRORS[result.error] || "Sign-in didn't work. Check the details and try again.");
        return result;
      });
    });
  }

  function stopSignIn() {
    if (signin.timer) clearTimeout(signin.timer);
    signin = { flowId: null, code: null, timer: null };
  }

  function signInResult(result) {
    if (result.status === "signed_in") {
      stopSignIn();
      connectionTest = null;
      return request("GET").then(function (fresh) { draft = fresh.draft; });
    }
    if (result.status === "pending" && signin.flowId) {
      signin.timer = setTimeout(function () {
        callSignIn({ action: "poll", flowId: signin.flowId }).then(signInResult)
          .catch(function (error) { stopSignIn(); showError(error.message); render(); })
          .then(function () { render(); });
      }, 2000);
    }
  }

  function startSignIn(body) {
    if (busy) return;
    busy = true;
    showError("");
    stopSignIn();
    render();
    callSignIn(body).then(function (result) {
      if (result.status === "pending") {
        signin.flowId = result.flowId;
        signin.code = result.code || null;
        if (result.authUrl && result.authUrl.indexOf("https://app.plex.tv/") === 0) window.open(result.authUrl, "_blank", "noopener");
      }
      return signInResult(result);
    }).catch(function (error) { showError(error.message); })
      .then(function () { busy = false; render(); });
  }

  function field(id, label, type, value) {
    return el("label", { htmlFor: id }, [label, el("br"), el("input", { id: id, type: type, value: value || "", autocomplete: type === "password" ? "current-password" : "off", size: 36 })]);
  }

  function value(id) {
    var node = document.getElementById(id);
    return node ? node.value.trim() : "";
  }

  function signInPanel() {
    var name = nameOf(PROVIDERS, draft.provider);
    var parts = [el("h2", { textContent: "Sign in to " + name })];
    if (draft.account) {
      parts.push(el("p", { textContent: "Signed in as " + draft.account.displayName + ". Your sign-in is saved in Windows Credential Manager, not in this page." }));
      parts.push(el("button", { type: "button", id: "connectionTest", textContent: "Test connection" }));
      if (connectionTest) parts.push(el("p", { id: "connectionResult", role: "status", textContent: connectionTest }));
    }
    if (draft.provider === "plex") {
      parts.push(field("serverUrl", "Plex server address", "url", DEFAULT_URLS.plex));
      parts.push(el("p", { textContent: signin.flowId ? "Finish signing in on the Plex page. This page updates when you're done." : "Plex opens in a new tab so you can approve NowPlaying." }));
      parts.push(el("button", { type: "button", id: "signinStart", textContent: draft.account ? "Sign in again" : "Open Plex sign-in" }));
    } else if (draft.provider === "jellyfin") {
      parts.push(field("serverUrl", "Server address", "url", DEFAULT_URLS.jellyfin));
      if (signin.code) parts.push(el("p", {}, ["In Jellyfin, open Quick Connect and enter this code: ", el("strong", { id: "quickConnectCode", textContent: signin.code })]));
      parts.push(el("button", { type: "button", id: "signinStart", textContent: signin.code ? "Get a new code" : "Get a Quick Connect code" }));
    } else {
      parts.push(field("serverUrl", "Server address", "url", DEFAULT_URLS[draft.provider]));
      parts.push(field("username", "Username", "text", ""));
      parts.push(field("password", "Password", "password", ""));
      parts.push(el("p", { textContent: "Your password is only sent to your server. It is never saved." }));
      parts.push(el("button", { type: "button", id: "signinStart", textContent: "Sign in" }));
    }
    return parts;
  }

  function runConnectionTest() {
    if (busy) return;
    busy = true;
    connectionTest = "Testing...";
    render();
    fetch(TEST_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (response) { return response.json().catch(function () { return {}; }); })
      .then(function (result) { connectionTest = TEST_MESSAGES[result.status] || "Couldn't test the connection. Try again."; })
      .catch(function () { connectionTest = "Couldn't reach NowPlaying. Make sure it is running."; })
      .then(function () { busy = false; render(); });
  }

  function onSignInClick() {
    if (draft.provider === "plex") return startSignIn({ action: "start", provider: "plex", baseUrl: value("serverUrl") });
    if (draft.provider === "jellyfin") return startSignIn({ action: "start", provider: "jellyfin", baseUrl: value("serverUrl") });
    var password = document.getElementById("password");
    var body = { action: "password", provider: draft.provider, baseUrl: value("serverUrl"), username: value("username"), password: password ? password.value : "" };
    if (password) password.value = "";
    startSignIn(body);
  }

  function send(method, body) {
    stopSignIn();
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
    var startup = document.getElementById("startWithWindows");
    if (startup) result.startWithWindows = startup.checked;
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
      case "signin":
        return signInPanel();
      case "discord":
        return [
          el("h2", { textContent: "Discord status" }),
          el("label", {}, [el("input", { type: "checkbox", id: "discordEnabled", checked: draft.discordEnabled }), " Show what I'm playing on Discord"]),
          el("label", { htmlFor: "discordIdleBehavior" }, ["When nothing is playing: "]),
          el("select", { id: "discordIdleBehavior" }, IDLE.map(function (item) { return el("option", { value: item[0], textContent: item[1], selected: draft.discordIdleBehavior === item[0] }); })),
        ].concat(draft.startWithWindows === null ? [] : [
          el("label", {}, [el("input", { type: "checkbox", id: "startWithWindows", checked: draft.startWithWindows }), " Start NowPlaying when I sign in to Windows"]),
        ]);
      case "review":
        return [
          el("h2", { textContent: "Check your choices" }),
          el("p", { textContent: "Media server: " + nameOf(PROVIDERS, draft.provider) + (draft.account ? " (signed in as " + draft.account.displayName + ")" : "") }),
          el("p", { textContent: "Discord status: " + (draft.discordEnabled ? "On" : "Off") + " - when idle: " + nameOf(IDLE, draft.discordIdleBehavior) }),
        ].concat(draft.startWithWindows === null ? [] : [el("p", { textContent: "Start with Windows: " + (draft.startWithWindows ? "On" : "Off") })]);
      default:
        return [el("h2", { textContent: "All set" }), el("p", { textContent: draft.account ? "You're signed in to " + nameOf(PROVIDERS, draft.provider) + " as " + draft.account.displayName + ", and your choices are saved." : "Your choices are saved." })];
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
    var needsSignIn = draft.step === "signin" && !draft.account;
    document.getElementById("back").disabled = busy || index <= 0;
    document.getElementById("next").disabled = busy || index >= STEPS.length - 1 || needsProvider || needsSignIn;
    var start = document.getElementById("signinStart");
    if (start) start.disabled = busy;
    var tester = document.getElementById("connectionTest");
    if (tester) tester.disabled = busy;
    document.getElementById("next").textContent = draft.step === "review" ? "Finish" : "Next";
    document.getElementById("reset").disabled = busy;
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("panel").addEventListener("change", function () {
      if (draft && draft.step === "provider") document.getElementById("next").disabled = busy || !document.querySelector("input[name=provider]:checked");
    });
    document.getElementById("panel").addEventListener("click", function (event) {
      if (event.target && event.target.id === "signinStart") onSignInClick();
      if (event.target && event.target.id === "connectionTest") runConnectionTest();
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
