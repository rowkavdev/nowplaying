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
figure{margin:0 0 1rem}figure img{display:block;max-width:100%;height:auto}figcaption{font-size:.875rem;color:#bbb}
h1{font-size:1.5rem}
ol{display:flex;flex-wrap:wrap;gap:.25rem .75rem;padding:0;list-style:none;font-size:.85rem;color:#aaa}
ol li[aria-current=step]{color:#fff;font-weight:600}
label{display:block;margin:.5rem 0}
fieldset{border:0;margin:0;padding:0}
select{font:inherit}
nav{display:flex;gap:.5rem;margin-top:2rem}
button{font:inherit;padding:.5rem 1rem;border-radius:.4rem;border:1px solid #555;background:#222;color:#eee;cursor:pointer}
button#next{background:#0b5cad;border-color:#0b5cad;color:#fff}
:focus-visible{outline:3px solid #7ab8ff;outline-offset:2px}
fieldset{border:0;margin:0;padding:0}
button.link{margin-left:auto;background:none;border:none;text-decoration:underline}
button:disabled{opacity:.5;cursor:default}
#addServer{margin-left:.5rem}
#addedServers button{margin-left:.5rem;padding:.2rem .6rem}
#error{color:#f0a040}
#error::before{content:"! ";font-weight:700}
`;

const JS = `"use strict";
(function () {
  var API = "/api/setup/draft";
  var SIGNIN_API = "/api/setup/signin";
  var TEST_API = "/api/setup/test";
  var HOSTED_API = "/api/setup/hosted/";
  var SPOTIFY_API = "/api/setup/spotify";
  var SPOTIFY_ERRORS = {
    bad_client_id: "That doesn't look like a Spotify Client ID. It's the 32-character ID on your app's page in the Spotify developer dashboard.",
    denied: "Spotify access wasn't allowed. Try again and choose Agree.",
    expired: "That Spotify sign-in expired. Start again.",
    too_many_signins: "Too many sign-ins are open. Wait a minute and try again.",
  };
  var spotify = { flowId: null, timer: null, clientId: "" };
  var TEST_MESSAGES = {
    connected: "Connected. NowPlaying can see what you're playing.",
    authentication_failed: "Your server rejected the saved sign-in. Sign in again.",
    unreachable: "Couldn't reach your server. Check the address and that the server is running.",
    name_not_found: "Couldn't find a server with that name. Check the address is spelled right, or use the server's IP address.",
    tls_untrusted: "Your server's security certificate isn't trusted (it may be self-signed or out of date). Give the server a certificate Windows trusts, or use its local http:// address.",
    timed_out: "Your server took too long to answer. Check the address and that the server is running.",
    connection_failed: "Your server answered, but not in a way NowPlaying understands. Check the address points at your media server.",
    missing_server: "Add your server address, then sign in again.",
    credential_unavailable: "Your saved sign-in is missing from Windows Credential Manager. Sign in again.",
    invalid_configuration: "The saved details look wrong. Sign in again.",
    not_signed_in: "Sign in first, then test the connection.",
    too_many_tests: "Too many tests in a row. Wait a few seconds and try again.",
    user_mismatch: "Your server says this sign-in belongs to a different user. Sign in again with the account you play on."
  };
  var connectionTest = null;
  var DISCORD_TEST_MESSAGES = {
    connected: "Discord is working. You should have seen a test status for a few seconds.",
    not_running: "Discord isn't open. Start the Discord desktop app (the website won't work), then try again.",
    no_answer: "Discord is open but didn't answer. Restart the Discord app, then try again.",
    rejected: "Discord refused the test status. Check 'Share your activity' is on in Discord's Activity Privacy settings.",
    no_app_id: "This build of NowPlaying has no Discord app ID, so it can't show a status.",
    test_running: "A test is already running. Wait a few seconds."
  };
  var STEPS = ["welcome", "provider", "signin", "discord", "hosting", "review", "complete"];
  var PREVIEWS = [["music", "Music"], ["episode", "TV episode"], ["film", "Film"]];
  var LABELS = { welcome: "Welcome", provider: "Media server", signin: "Sign in", discord: "Discord", hosting: "Card hosting", review: "Review", complete: "Done" };
  var DEFAULT_URLS = { plex: "http://127.0.0.1:32400", jellyfin: "http://127.0.0.1:8096", emby: "http://127.0.0.1:8096", navidrome: "http://127.0.0.1:4533" };
  var SIGNIN_ERRORS = {
    authentication_failed: "That username or password didn't work.",
    invalid_server_url: "Enter the server address, like http://127.0.0.1:8096.",
    unreachable: "Couldn't reach that server. Check the address and that the server is running.",
    name_not_found: "Couldn't find a server with that name. Check the address is spelled right, or use the server's IP address.",
    tls_untrusted: "This server's security certificate isn't trusted (it may be self-signed or out of date). Give the server a certificate Windows trusts, or use its local http:// address.",
    timed_out: "That server took too long to answer. Check the address and that the server is running.",
    quick_connect_disabled: "Quick Connect is turned off on this Jellyfin server. Turn it on in the Jellyfin dashboard and try again.",
    expired: "That sign-in expired. Start again.",
    too_many_signins: "Too many sign-ins are open. Wait a minute and try again.",
  };
  var signin = { flowId: null, code: null, timer: null };
  var DRAFT_ERRORS = {
    too_many_servers: "You can add up to 8 servers.",
    server_not_found: "That server was already removed.",
  };
  var PROVIDERS = [["plex", "Plex"], ["jellyfin", "Jellyfin"], ["emby", "Emby"], ["navidrome", "Navidrome"]];
  // Provider-specific sign-in help (#141) for the username and password providers.
  var SIGNIN_HELP = {
    emby: "Sign in as the Emby user whose playback you want to show, with the username and password you use in the Emby app. NowPlaying saves the sign-in Emby hands back, not your password.",
    navidrome: "Use the username and password you sign in to Navidrome with. The address is usually your server on port 4533. NowPlaying saves a salted hash of it, not your password.",
  };
  var IDLE = [["clear", "Clear my status"], ["grace", "Keep it for a short grace period"], ["show", "Show that nothing is playing"], ["recent", "Show what I played last"]];
  var draft = null;
  var busy = false;
  // Card hosting step (#140): the choice and typed address live here until
  // Next saves them, so switching options doesn't lose what was typed.
  var HOSTING = [["off", "Not now"], ["hosted", "NowPlaying's hosted service"], ["self", "My own card service (self-hosted)"]];
  var HOSTED_CHECK = {
    ok: "That's a NowPlaying card service.",
    invalid_url: "Enter the service address, starting with https://.",
    bad_status: "That address answered, but not like a NowPlaying card service.",
    not_nowplaying: "That address answered, but not like a NowPlaying card service.",
    timeout: "That address took too long to answer.",
    unreachable: "Couldn't reach that address. Check it and that the service is running."
  };
  var hosting = { choice: null, url: null, check: "", preview: null, previewFailed: false, loading: false };

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
      if (response.ok) return response.json();
      return response.json().catch(function () { return {}; }).then(function (result) {
        var error = new Error("Request failed (" + response.status + ")");
        error.code = result.error;
        throw error;
      });
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

  // Optional Spotify sign-in (#135). Spotify only feeds the card and the
  // hosted card, never Discord.
  function callSpotify(body) {
    var init = { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(body) };
    return fetch(SPOTIFY_API, init).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (result) {
        if (!response.ok) throw new Error(SPOTIFY_ERRORS[result.error] || "Spotify sign-in didn't work. Check the Client ID and try again.");
        return result;
      });
    });
  }

  function stopSpotify() {
    if (spotify.timer) clearTimeout(spotify.timer);
    spotify.flowId = null;
    spotify.timer = null;
  }

  function spotifyResult(result) {
    if (result.status === "signed_in") {
      stopSpotify();
      return request("GET").then(function (fresh) { draft = fresh.draft; });
    }
    if (result.status === "pending" && spotify.flowId) {
      spotify.timer = setTimeout(function () {
        callSpotify({ action: "poll", flowId: spotify.flowId }).then(spotifyResult)
          .catch(function (error) { stopSpotify(); showError(error.message); })
          .then(function () { render(); });
      }, 2000);
    }
  }

  function startSpotify() {
    if (busy) return;
    spotify.clientId = value("spotifyClientId");
    busy = true;
    showError("");
    stopSpotify();
    render();
    callSpotify({ action: "start", clientId: spotify.clientId }).then(function (result) {
      if (result.status === "pending") {
        spotify.flowId = result.flowId;
        if (result.authUrl && result.authUrl.indexOf("https://accounts.spotify.com/") === 0) window.open(result.authUrl, "_blank", "noopener");
      }
      return spotifyResult(result);
    }).catch(function (error) { showError(error.message); })
      .then(function () { busy = false; render(); });
  }

  function spotifyPanel() {
    var parts = [el("h3", { textContent: "Spotify on your card (optional)" })];
    if (draft.spotify) {
      parts.push(el("p", { id: "spotifyAccount", textContent: "Connected as " + draft.spotify.identity.displayName + ". Spotify shows on your card only, not on Discord." }));
      parts.push(el("button", { type: "button", id: "spotifyClear", textContent: "Disconnect Spotify" }));
      return parts;
    }
    parts.push(el("p", { textContent: "Shows what you play on Spotify on your card and hosted card, never on Discord. You need a Client ID from your own app in the Spotify developer dashboard, with http://127.0.0.1/spotify/callback as its redirect URI." }));
    parts.push(field("spotifyClientId", "Spotify Client ID", "text", spotify.clientId));
    if (spotify.flowId) parts.push(el("p", { textContent: "Finish signing in on the Spotify page. This page updates when you're done." }));
    parts.push(el("button", { type: "button", id: "spotifyStart", textContent: spotify.flowId ? "Open Spotify sign-in again" : "Sign in with Spotify" }));
    return parts;
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
      // Several servers (#252): keep this one and sign in to another.
      parts.push(el("button", { type: "button", id: "addServer", textContent: "Add another server" }));
    }
    if (draft.servers && draft.servers.length) parts.push(el("p", { textContent: "Also added:" }), addedServers(false));
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
      if (SIGNIN_HELP[draft.provider]) parts.push(el("p", { id: "signinHelp", textContent: SIGNIN_HELP[draft.provider] }));
      parts.push(field("username", "Username", "text", ""));
      parts.push(field("password", "Password", "password", ""));
      parts.push(el("p", { textContent: "Your password is only sent to your server. It is never saved." }));
      parts.push(el("button", { type: "button", id: "signinStart", textContent: "Sign in" }));
    }
    // Offered once the media server sign-in is done.
    if (draft.account) parts = parts.concat(spotifyPanel());
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

  // Updates the result in place so unsaved choices on the step stay as they are.
  function runDiscordTest() {
    var button = document.getElementById("discordTest");
    var out = document.getElementById("discordTestResult");
    if (!button || button.disabled) return;
    button.disabled = true;
    out.textContent = "Testing... look at your Discord status.";
    fetch("/api/setup/discord-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (response) { return response.json().catch(function () { return {}; }); })
      .then(function (result) { out.textContent = DISCORD_TEST_MESSAGES[result.status] || "Couldn't test Discord. Try again."; })
      .catch(function () { out.textContent = "Couldn't reach NowPlaying. Make sure it is running."; })
      .then(function () { button.disabled = false; });
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
      .catch(function (error) { showError(DRAFT_ERRORS[error.code] || "Couldn't save that step. Check NowPlaying is still running and try again."); })
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
    var art = document.getElementById("discordArtworkLookup");
    if (art) result.discordArtworkLookup = art.checked;
    var startup = document.getElementById("startWithWindows");
    if (startup) result.startWithWindows = startup.checked;
    var host = document.querySelector("input[name=hosting]:checked");
    if (host) {
      result.hostedEnabled = host.value !== "off";
      result.hostedUrl = host.value === "self" ? value("hostedUrl") || null : null;
    }
    return result;
  }

  function accountLabel(account) {
    return nameOf(PROVIDERS, account.provider) + " (signed in as " + account.displayName + ")";
  }

  // Servers already signed in with "Add another server". On review each one
  // gets a Remove button; the account signed in last is always kept.
  function addedServers(removable, withCurrent) {
    var list = el("ul", { id: "addedServers" }, draft.servers.map(function (account) {
      var item = el("li", { textContent: accountLabel(account) + " " });
      if (removable) {
        var remove = el("button", { type: "button", className: "removeServer", textContent: "Remove" });
        remove.dataset.provider = account.provider;
        remove.dataset.id = account.id;
        item.append(remove);
      }
      return item;
    }));
    if (withCurrent && draft.account) list.append(el("li", { textContent: accountLabel(draft.account) }));
    return list;
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
        var adding = draft.servers && draft.servers.length > 0 && !draft.account;
        return [el("h2", { textContent: adding ? "Which server do you want to add?" : "Which media server do you use?" })]
          .concat(adding ? [el("p", { textContent: "Already added:" }), addedServers(false)] : [])
          .concat([el("fieldset", { ariaLabel: "Media server" }, PROVIDERS.map(function (item) {
            return el("label", {}, [el("input", { type: "radio", name: "provider", value: item[0], checked: draft.provider === item[0] }), " " + item[1]]);
          }))])
          .concat(adding ? [el("button", { type: "button", id: "cancelAddServer", textContent: "Don't add another server" })] : []);
      case "signin":
        return signInPanel();
      case "discord":
        return [
          el("h2", { textContent: "Discord status" }),
          el("label", {}, [el("input", { type: "checkbox", id: "discordEnabled", checked: draft.discordEnabled }), " Show what I'm playing on Discord"]),
          el("label", { htmlFor: "discordIdleBehavior" }, ["When nothing is playing: "]),
          el("select", { id: "discordIdleBehavior" }, IDLE.map(function (item) { return el("option", { value: item[0], textContent: item[1], selected: draft.discordIdleBehavior === item[0] }); })),
          el("label", {}, [el("input", { type: "checkbox", id: "discordArtworkLookup", checked: draft.discordArtworkLookup !== false }), " Look up album art online"]),
          el("p", { textContent: "Sends only the track title and artist to MusicBrainz to find the cover. Your server address and account are never sent." }),
          el("button", { type: "button", id: "discordTest", textContent: "Test Discord" }),
          el("p", { id: "discordTestResult", role: "status" }),
        ].concat(draft.startWithWindows === null ? [] : [
          el("label", {}, [el("input", { type: "checkbox", id: "startWithWindows", checked: draft.startWithWindows }), " Start NowPlaying when I sign in to Windows"]),
        ]);
      case "hosting":
        return hostingPanel();
      case "review":
        return [
          el("h2", { textContent: "Check your choices" }),
        ].concat(draft.servers && draft.servers.length ? [
          el("p", { textContent: "Media servers:" }),
          addedServers(true, true),
        ] : [
          el("p", { textContent: "Media server: " + nameOf(PROVIDERS, draft.provider) + (draft.account ? " (signed in as " + draft.account.displayName + ")" : "") }),
        ]).concat([
          el("p", { textContent: "Discord status: " + (draft.discordEnabled ? "On" : "Off") + " - when idle: " + nameOf(IDLE, draft.discordIdleBehavior) }),
          el("p", { textContent: "Album art lookup: " + (draft.discordArtworkLookup !== false ? "On" : "Off") }),
          el("p", { textContent: "Spotify on your card: " + (draft.spotify ? "On (signed in as " + draft.spotify.identity.displayName + ")" : "Off") }),
          el("p", { textContent: "Card hosting: " + (draft.hostedEnabled === true ? (draft.hostedUrl ? "Your own service at " + draft.hostedUrl : "NowPlaying's hosted service") : "Off") }),
        ]).concat(draft.startWithWindows === null ? [] : [el("p", { textContent: "Start with Windows: " + (draft.startWithWindows ? "On" : "Off") })]).concat([
          el("h3", { textContent: "How your card will look" }),
          el("p", { textContent: "Made-up examples. You can change the look later on the settings page." }),
        ], PREVIEWS.map(function (item) {
          return el("figure", {}, [el("img", { src: "/api/setup/preview/" + item[0] + ".svg", alt: "Example card for " + item[1] }), el("figcaption", { textContent: item[1] })]);
        }));
      default:
        if (draft.account && draft.servers && draft.servers.length) return [el("h2", { textContent: "All set" }), el("p", { textContent: "You're signed in to " + (draft.servers.length + 1) + " media servers, and your choices are saved." })];
        return [el("h2", { textContent: "All set" }), el("p", { textContent: draft.account ? "You're signed in to " + nameOf(PROVIDERS, draft.provider) + " as " + draft.account.displayName + ", and your choices are saved." : "Your choices are saved." })];
    }
  }

  function hostingChoice() {
    if (hosting.choice) return hosting.choice;
    return draft.hostedEnabled === true ? (draft.hostedUrl ? "self" : "hosted") : "off";
  }

  function hostingPanel() {
    var choice = hostingChoice();
    var parts = [
      el("h2", { textContent: "Card hosting" }),
      el("p", { textContent: "Put your card online so a GitHub README can show it, without opening your media server to the internet. You can change this later in Settings." }),
      el("fieldset", { ariaLabel: "Card hosting" }, HOSTING.map(function (item) {
        return el("label", {}, [el("input", { type: "radio", name: "hosting", value: item[0], checked: choice === item[0] }), " " + item[1]]);
      })),
    ];
    if (choice === "self") {
      parts.push(field("hostedUrl", "Card service address", "url", hosting.url !== null ? hosting.url : (draft.hostedUrl || "")));
      parts.push(el("button", { type: "button", id: "hostedCheck", textContent: "Check this address" }));
      parts.push(el("p", { id: "hostedCheckResult", role: "status", textContent: hosting.check }));
    }
    if (choice === "off") return parts;
    // Signing this PC in to the hosted service (GitHub sign-in) goes here once it lands.
    parts.push(el("div", { id: "hostedSignIn" }));
    parts.push(el("h3", { textContent: "What leaves your PC" }));
    if (!hosting.preview) {
      parts.push(el("p", { textContent: hosting.previewFailed ? "Couldn't load the list. Check NowPlaying is still running." : "Loading..." }));
      if (!hosting.previewFailed) loadHostedPreview();
      return parts;
    }
    var preview = hosting.preview;
    if (choice === "hosted" && preview.defaultUrl) parts.push(el("p", { textContent: "Your card goes to " + preview.defaultUrl.replace("https://", "") + "." }));
    parts.push(el("p", { textContent: "Sent, with your current card and privacy settings:" }));
    parts.push(el("ul", { id: "hostedSent" }, preview.sent.map(function (item) { return el("li", { textContent: item.label }); })
      .concat(preview.alwaysSent.map(function (label) { return el("li", { textContent: label }); }))));
    if (preview.withheld && preview.withheld.length) {
      parts.push(el("p", { textContent: "Not sent, because your card doesn't show it:" }));
      parts.push(el("ul", { id: "hostedWithheld" }, preview.withheld.map(function (item) { return el("li", { textContent: item.label }); })));
    }
    parts.push(el("p", { textContent: "Never sent:" }));
    parts.push(el("ul", { id: "hostedNever" }, preview.neverSent.map(function (label) { return el("li", { textContent: label }); })));
    return parts;
  }

  function loadHostedPreview() {
    if (hosting.loading) return;
    hosting.loading = true;
    fetch(HOSTED_API + "preview", { cache: "no-store" })
      .then(function (response) { if (!response.ok) throw new Error("preview"); return response.json(); })
      .then(function (result) { hosting.preview = result; })
      .catch(function () { hosting.previewFailed = true; })
      .then(function () { hosting.loading = false; if (draft && draft.step === "hosting") render(); });
  }

  function runHostedCheck() {
    var button = document.getElementById("hostedCheck");
    var out = document.getElementById("hostedCheckResult");
    if (!button || button.disabled) return;
    hosting.url = value("hostedUrl");
    button.disabled = true;
    out.textContent = "Checking...";
    fetch(HOSTED_API + "check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: hosting.url }) })
      .then(function (response) { return response.json().catch(function () { return {}; }); })
      .then(function (result) { hosting.check = result.ok ? HOSTED_CHECK.ok : (HOSTED_CHECK[result.reason] || HOSTED_CHECK.invalid_url); })
      .catch(function () { hosting.check = "Couldn't reach NowPlaying. Make sure it is running."; })
      .then(function () { out.textContent = hosting.check; button.disabled = false; });
  }

  function needsHostedUrl() {
    return draft.step === "hosting" && hostingChoice() === "self" && !value("hostedUrl");
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
    document.getElementById("next").disabled = busy || index >= STEPS.length - 1 || needsProvider || needsSignIn || needsHostedUrl();
    var start = document.getElementById("signinStart");
    if (start) start.disabled = busy;
    var tester = document.getElementById("connectionTest");
    if (tester) tester.disabled = busy;
    ["addServer", "cancelAddServer", "spotifyStart", "spotifyClear"].forEach(function (id) { var node = document.getElementById(id); if (node) node.disabled = busy; });
    Array.prototype.forEach.call(document.querySelectorAll(".removeServer"), function (node) { node.disabled = busy; });
    document.getElementById("next").textContent = draft.step === "review" ? "Finish" : "Next";
    document.getElementById("reset").disabled = busy;
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("panel").addEventListener("change", function () {
      if (draft && draft.step === "provider") document.getElementById("next").disabled = busy || !document.querySelector("input[name=provider]:checked");
      var host = document.querySelector("input[name=hosting]:checked");
      if (draft && draft.step === "hosting" && host && host.value !== hostingChoice()) {
        if (document.getElementById("hostedUrl")) hosting.url = value("hostedUrl");
        hosting.choice = host.value;
        hosting.check = "";
        render();
      }
    });
    document.getElementById("panel").addEventListener("input", function (event) {
      if (event.target && event.target.id === "hostedUrl") {
        hosting.url = event.target.value;
        document.getElementById("next").disabled = busy || needsHostedUrl();
      }
    });
    document.getElementById("panel").addEventListener("click", function (event) {
      if (event.target && event.target.id === "signinStart") onSignInClick();
      if (event.target && event.target.id === "connectionTest") runConnectionTest();
      if (event.target && event.target.id === "discordTest") runDiscordTest();
      if (event.target && event.target.id === "hostedCheck") runHostedCheck();
      if (event.target && event.target.id === "spotifyStart") startSpotify();
      if (event.target && event.target.id === "spotifyClear") send("POST", { action: "clear-spotify" });
      if (event.target && event.target.id === "addServer") send("POST", { action: "add-server" });
      if (event.target && event.target.id === "cancelAddServer") send("POST", { action: "cancel-add-server" });
      if (event.target && event.target.classList && event.target.classList.contains("removeServer")) {
        send("POST", { action: "remove-server", server: { provider: event.target.dataset.provider, id: event.target.dataset.id } });
      }
    });
    document.getElementById("next").addEventListener("click", function () { send("POST", { action: "next", changes: changes() }); });
    document.getElementById("back").addEventListener("click", function () { send("POST", { action: "back", changes: changes() }); });
    document.getElementById("reset").addEventListener("click", function () { send("DELETE"); });
    request("GET").then(function (result) { draft = result.draft; render(); })
      .catch(function () { showError("Couldn't reach NowPlaying. Make sure it is running, then reload this page."); });
  });
})();
`;

// Example cards on their own page, for the native setup window's review step
// (WinForms can't draw SVG, so it opens this in the browser).
const PREVIEW_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NowPlaying card examples</title>
<link rel="stylesheet" href="/setup/app.css">
</head>
<body>
<main>
<h1>How your card will look</h1>
<p>Made-up examples. You can change the look later on the settings page.</p>
<figure><img src="/api/setup/preview/music.svg" alt="Example card for Music"><figcaption>Music</figcaption></figure>
<figure><img src="/api/setup/preview/episode.svg" alt="Example card for TV episode"><figcaption>TV episode</figcaption></figure>
<figure><img src="/api/setup/preview/film.svg" alt="Example card for Film"><figcaption>Film</figcaption></figure>
</main>
</body>
</html>
`;

const ASSETS = Object.freeze({
  "/setup": { type: "text/html; charset=utf-8", body: HTML, page: true },
  "/setup/preview": { type: "text/html; charset=utf-8", body: PREVIEW_HTML, page: true },
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
