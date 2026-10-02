// Local settings page (#253): Discord section (#272), including what
// Discord shows when nothing is playing, and card appearance (#94). Served on loopback by
// the running app next to the status page. Saves go to /api/settings as JSON;
// the HTTP server only lets them through with the session cookie this page
// sets, from the app's own origin.

import { readFileSync } from "node:fs";
import { normalizeCard } from "./setup-config.js";
import { HOSTED_DEVICES_SCRIPT } from "./hosted-devices.js";
import { ONBOARDING_HTML, SERVER_CSS, SERVER_SCRIPT, SERVICE_SCRIPT, serverPanel, servicePanel } from "./settings-onboarding-page.js";

// Startup copy is platform-aware (#677): the control drives a Windows
// shortcut, a macOS LaunchAgent or an XDG autostart entry depending on the
// OS, so naming Windows on Unix tells the user it controls the wrong OS.
const STARTUP_COPY = {
  win32: {
    heading: "Windows",
    label: "Start NowPlaying when I sign in to Windows",
    toolbarRepair: "Startup shortcut needs repair - use the Windows section below.",
    formRepair: "Startup shortcut points to another install. Check the box and Save to fix it.",
  },
  darwin: {
    heading: "Startup",
    label: "Start NowPlaying at login",
    toolbarRepair: "Startup entry needs repair - use the Startup section below.",
    formRepair: "The saved LaunchAgent is disabled or was edited. Check the box and Save to repair it.",
  },
  linux: {
    heading: "Startup",
    label: "Start NowPlaying at login",
    toolbarRepair: "Startup entry needs repair - use the Startup section below.",
    formRepair: "The autostart entry is disabled or was edited. Check the box and Save to repair it.",
  },
};
// Unknown platforms get the generic Unix wording - it names no OS.
function startupCopyFor(platform) {
  return STARTUP_COPY[platform] ?? STARTUP_COPY.linux;
}

const buildPage = (startupCopy) => `<!doctype html>
<html lang="en" class="drpp-root"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NowPlaying settings</title><link rel="stylesheet" href="/status.css"><link rel="stylesheet" href="/settings.css"><link rel="stylesheet" href="/drpp-shell.css"></head>
<body class="drpp-shell"><a class="drpp-skip" href="#settings-content">Skip to configuration</a><header class="drpp-header">
  <div class="drpp-heading"><h1>NowPlaying</h1><span class="drpp-divider"></span><span id="drpp-version">Version: checking...</span><button type="button" disabled title="Updater integration not available">Check for Updates (coming soon)</button></div>
  <div class="drpp-actions"><a href="/" title="Status">Status</a><a href="https://github.com/rowkavdev/nowplaying" target="_blank" rel="noopener noreferrer" title="GitHub">GitHub ↗</a><button type="button" id="drpp-info-open" aria-haspopup="dialog" title="Info">Info</button></div>
</header><div class="drpp-columns"><main class="drpp-config" id="settings-content" tabindex="-1">
<div class="drpp-panel-heading"><h2>Configuration</h2><span class="drpp-divider"></span><span>Save each section below</span><span class="drpp-divider" id="drpp-autostart-divider" hidden></span><label id="drpp-autostart-wrap" hidden><input type="checkbox" id="drpp-autostart"> Launch app on system startup</label><small id="drpp-autostart-result" role="status" aria-live="polite"></small></div>
<div class="drpp-config-scroll" tabindex="0" aria-label="Configuration sections">
<div class="drpp-setup" id="drpp-setup" role="status" aria-live="polite" hidden>
<div class="drpp-setup-title"><span aria-hidden="true">⚠</span><strong id="drpp-setup-title">Setup Incomplete</strong></div>
<p id="drpp-setup-message">Add a media server to finish setting up.</p>
<a href="#servers-section" id="drpp-setup-action">Add Server</a>
</div>
<details class="drpp-accordion" open><summary>Media servers</summary>${serverPanel()}</details>
<details class="drpp-accordion"><summary>Connected services</summary>${servicePanel()}</details>
<details class="drpp-accordion"><summary>Discord Settings</summary>
<form id="discord-form">
<section aria-labelledby="h-discord"><h2 id="h-discord">Discord</h2>
<p class="row"><label><input type="checkbox" id="discord-enabled" name="enabled"> Show what I'm playing on Discord</label></p>
<p class="row"><label for="discord-timestamps">Timer</label>
<select id="discord-timestamps" name="timestamps">
<option value="both">Time played and time left</option>
<option value="elapsed">Time played</option>
<option value="remaining">Time left</option>
<option value="none">No timer</option>
</select></p>
<p class="row"><label for="discord-idle">When nothing is playing</label>
<select id="discord-idle" name="idleBehavior">
<option value="clear">Clear my status</option>
<option value="grace">Keep it for a short grace period</option>
<option value="show">Show that nothing is playing</option>
<option value="recent">Show what I played last</option>
</select></p>
<p class="row"><label for="discord-upload">Show my server's cover</label>
<input type="checkbox" id="discord-upload" name="artworkUpload" aria-describedby="discord-upload-help"></p>
<p class="hint" id="discord-upload-help">Discord can only show a picture from a public address, so this uploads just the cover image to litterbox.catbox.moe, where it is kept for 72 hours. No title, artist, token or server address is sent. Turn it off and a private server's art is never sent to Discord.</p>
<p class="row"><label for="discord-artwork">If that fails</label>
<select id="discord-artwork" name="artworkLookup" aria-describedby="discord-artwork-help">
<option value="musicbrainz">Look up the cover on MusicBrainz</option>
<option value="off">Show the NowPlaying icon</option>
</select></p>
<p class="hint" id="discord-artwork-help">MusicBrainz lookups send only the track title and artist to musicbrainz.org and coverartarchive.org.</p>
<p><button type="submit" id="discord-save" aria-label="Save Discord settings">Save</button> <span id="discord-result" role="status" aria-live="polite"></span></p>
<p class="row"><button type="button" id="refresh-art">Refresh album art</button> <span id="refresh-result" role="status" aria-live="polite"></span></p>
<p class="hint">Use this if Discord shows an old or wrong cover. It forgets saved covers and looks them up again now.</p>
</section>
</form>
</details>
<details class="drpp-accordion"><summary>Privacy Settings</summary>
<form id="privacy-form" hidden>
<section aria-labelledby="h-privacy"><h2 id="h-privacy">Privacy</h2>
<p class="hint">Applies to Discord, the hosted card and your local card.</p>
<p class="row"><label><input type="checkbox" id="privacy-hideTitles"> Hide titles (shows "Private media")</label></p>
<p class="row"><label><input type="checkbox" id="privacy-hideArtwork"> Hide album art</label></p>
<p class="row"><label><input type="checkbox" id="privacy-hideProgress"> Hide progress and timer</label></p>
<fieldset><legend>Don't show when I'm playing</legend>
<p class="row"><label><input type="checkbox" id="privacy-hideMovies"> Movies</label> <label><input type="checkbox" id="privacy-hideEpisodes"> TV episodes</label> <label><input type="checkbox" id="privacy-hideMusic"> Music</label></p>
</fieldset>
<p class="hint">Hidden kinds show as nothing playing. With titles or album art hidden, covers are never looked up on MusicBrainz.</p>
<p><button type="submit" id="privacy-save" aria-label="Save privacy settings">Save</button> <span id="privacy-result" role="status" aria-live="polite"></span></p>
</section>
</form>
</details>
<details class="drpp-accordion"><summary>Card Settings</summary>
<form id="card-form" hidden>
<section aria-labelledby="h-card"><h2 id="h-card">Card</h2>
<p class="hint">How your README card looks. Changes show in the preview straight away and are saved when you press Save. The hosted card link below uses these settings too, apart from artwork, which the hosted card never shows.</p>
<p class="row"><label for="card-theme">Style</label>
<select id="card-theme">
<option value="midnight-blue">Dark</option>
<option value="paper">Light</option>
<option value="compact">Compact (title only)</option>
</select></p>
<p class="row"><label for="card-width">Width</label><input type="number" id="card-width" min="280" max="800" step="1" inputmode="numeric" aria-describedby="card-width-help card-result"> <span class="unit" id="card-width-help">px, 280 to 800</span></p>
<p class="row"><label for="card-padding">Padding</label><input type="range" id="card-padding" min="12" max="48" step="1"> <output id="card-padding-value" for="card-padding"></output></p>
<p class="row"><label for="card-radius">Corners</label><input type="range" id="card-radius" min="0" max="24" step="1"> <output id="card-radius-value" for="card-radius"></output></p>
<p class="row"><label for="card-fontFamily">Font</label>
<select id="card-fontFamily">
<option value="system">System sans</option>
<option value="humanist">Humanist sans</option>
<option value="serif">Serif</option>
<option value="mono">Monospace</option>
</select></p>
<p class="row"><label for="card-fontStack">Custom font</label><input type="text" id="card-fontStack" aria-describedby="card-font-help card-font-error" maxlength="80" placeholder="e.g. Inter, Segoe UI" autocomplete="off"> <span class="unit" id="card-font-help">optional, overrides Font; up to 5 names, no quotes</span></p><p id="card-font-error" class="bad" role="status" aria-live="polite" hidden></p>
<p class="row"><label for="card-statusStyle">Status line</label>
<select id="card-statusStyle">
<option value="plain">Plain text</option>
<option value="caps">Capitals</option>
<option value="dot">Plain with a dot</option>
</select></p>
<p class="row"><label for="card-border">Border</label>
<select id="card-border">
<option value="thin">Thin line</option>
<option value="none">None</option>
</select></p>
<p class="row"><label for="card-background">Background</label>
<select id="card-background">
<option value="solid">Solid colour</option>
<option value="transparent">Transparent</option>
</select></p>
<p class="row"><label for="card-progressStyle">Bar ends</label>
<select id="card-progressStyle">
<option value="square">Square</option>
<option value="rounded">Rounded</option>
</select></p>
<p class="row"><label for="card-artShape">Artwork shape</label>
<select id="card-artShape">
<option value="square">Square</option>
<option value="rounded">Rounded corners</option>
<option value="circle">Circle</option>
</select></p>
<p class="row"><label><input type="checkbox" id="card-showProgress"> Show progress bar</label></p>
<p class="row"><label for="card-progressHeight">Bar thickness</label><input type="range" id="card-progressHeight" min="2" max="12" step="1"> <output id="card-progressHeight-value" for="card-progressHeight"></output></p>
<p class="row"><label for="card-progressPosition">Bar position</label>
<select id="card-progressPosition">
<option value="bottom">Bottom of the card</option>
<option value="text">Under the text</option>
</select></p>
<p class="row"><label for="card-progressWidth">Bar width</label>
<select id="card-progressWidth">
<option value="content">Text column</option>
<option value="full">Whole card</option>
</select></p>
<p class="row"><label for="card-artworkPosition">Artwork side</label>
<select id="card-artworkPosition">
<option value="left">Left</option>
<option value="right">Right</option>
</select></p>
<p class="row"><label for="card-artworkWidth">Artwork width</label><input type="range" id="card-artworkWidth" min="48" max="160" step="1"> <output id="card-artworkWidth-value" for="card-artworkWidth"></output></p>
<p class="row"><label for="card-artworkHeight">Artwork height</label><input type="range" id="card-artworkHeight" min="48" max="180" step="1"> <output id="card-artworkHeight-value" for="card-artworkHeight"></output></p>
<p class="row"><label for="card-fieldOrder">Line order</label>
<select id="card-fieldOrder">
<option value="state,title,subtitle">Status / Title / Subtitle</option>
<option value="state,subtitle,title">Status / Subtitle / Title</option>
<option value="title,state,subtitle">Title / Status / Subtitle</option>
<option value="title,subtitle,state">Title / Subtitle / Status</option>
<option value="subtitle,state,title">Subtitle / Status / Title</option>
<option value="subtitle,title,state">Subtitle / Title / Status</option>
</select></p>
<p class="row"><label for="card-textAlign">Text alignment</label>
<select id="card-textAlign">
<option value="start">Left</option>
<option value="middle">Centre</option>
<option value="end">Right</option>
</select></p>
<p class="row"><label for="card-direction">Text direction</label>
<select id="card-direction">
<option value="ltr">Left to right</option>
<option value="rtl">Right to left</option>
<option value="auto">Match the title</option>
</select></p>
<div class="preview"><p class="preview-label">Preview</p><img id="card-preview" alt="Preview of your card with these settings" hidden><p id="card-preview-note" class="hint" hidden>Can't show a preview right now.</p><p id="card-artwork-scale-note" class="hint" aria-live="polite" hidden></p></div>
<p><button type="submit" id="card-save" aria-label="Save card settings">Save</button> <button type="button" id="card-reset">Back to defaults</button> <span id="card-result" role="status" aria-live="polite"></span></p>
</section>
</form>
</details>
<details class="drpp-accordion"><summary>YouTube Settings</summary>
<section id="youtube-section" aria-labelledby="h-youtube" hidden><h2 id="h-youtube">YouTube</h2>
<p class="hint">Lets the NowPlaying for YouTube browser extension show what you're watching. Open the extension's options page, paste this pairing code and the port below, then press Save there. The extension only sends what's playing, and only to this PC.</p>
<dl><dt>Pairing code</dt><dd><code id="youtube-token" class="secret">&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;</code></dd>
<dt>Port</dt><dd><code id="youtube-port">-</code></dd></dl>
<p class="row"><button type="button" id="youtube-show" disabled aria-pressed="false">Show code</button> <button type="button" id="youtube-copy" disabled>Copy code</button> <button type="button" id="youtube-reset">Make a new code</button> <span id="youtube-result" role="status" aria-live="polite"></span></p>
<p class="hint">Keep the code to yourself. Anyone with it can change what your card and Discord show while NowPlaying is running. A new code stops the old one at once, so you'll need to paste it into the extension again.</p>
</section>
</details>
<details class="drpp-accordion"><summary>Startup Settings</summary>
<form id="startup-form" hidden>
<section aria-labelledby="h-startup"><h2 id="h-startup">${startupCopy.heading}</h2>
<p class="row"><label><input type="checkbox" id="startup-enabled"> ${startupCopy.label}</label></p>
<p><button type="submit" id="startup-save" aria-label="Save startup settings">Save</button> <span id="startup-result" role="status" aria-live="polite"></span></p>
</section>
</form>
</details>
<details class="drpp-accordion"><summary>Hosted Card Settings</summary>
<form id="hosted-form">
<section aria-labelledby="h-hosted"><h2 id="h-hosted">Hosted card</h2>
<p class="hint">Puts your card on nowplaying-hosted.vercel.app so a GitHub README can show it without opening your server to the internet. It sends only what your card shows: playing or paused, the title, artist and progress if the card shows them. Never your server address, user name, sign-in, artwork or Discord details. <a href="https://github.com/rowkavdev/nowplaying/blob/main/docs/hosted-upload.md">What leaves your PC</a></p>
<p class="row"><label><input type="checkbox" id="hosted-enabled" name="enabled"> Upload my card to the hosted service</label></p>
<dl id="hosted-details" hidden><dt>Upload</dt><dd id="hosted-state">-</dd><dt>Card link</dt><dd><a id="hosted-url" href="#">-</a> <button type="button" id="copy-url" aria-label="Copy hosted card address">Copy</button></dd>
<dt>README</dt><dd><code id="hosted-markdown">-</code> <button type="button" id="copy-markdown" aria-label="Copy hosted card README Markdown">Copy</button></dd></dl>
<p><button type="submit" id="hosted-save" aria-label="Save hosted card settings">Save</button> <button type="button" id="hosted-disconnect">Disconnect this PC</button> <span id="hosted-result" role="status" aria-live="polite"></span></p>
</section>
</form>
</details>
<!-- Hosted card devices (#140): markup only; script and route live in src/hosted-devices.js. -->
<details class="drpp-accordion"><summary>Hosted Card Devices</summary>
<section id="hosted-devices" aria-labelledby="h-hosted-devices" hidden><h2 id="h-hosted-devices">Hosted card devices</h2>
<p class="hint">PCs signed in as <strong id="hosted-devices-login">-</strong> that update your card. The one playing shows on the card.</p>
<ul id="hosted-devices-list" class="plain"></ul>
<p><button type="button" id="hosted-devices-everywhere">Sign out everywhere</button> <span id="hosted-devices-result" role="status" aria-live="polite"></span></p>
</section>
</details>
<!-- /Hosted card devices -->
</div></main><aside class="drpp-logs" aria-labelledby="drpp-log-heading">
<div class="drpp-panel-heading"><span class="drpp-indicator" id="drpp-log-indicator" role="img" aria-label="Log connection status"></span><h2 id="drpp-log-heading">Logs</h2><span class="drpp-divider"></span><label><input type="checkbox" id="drpp-auto-scroll" checked> Auto Scroll</label><label><input type="checkbox" id="drpp-wrap"> Wrap Text</label><span class="drpp-divider"></span><input id="drpp-search" type="search" aria-label="Search logs" aria-describedby="drpp-log-error" placeholder="Search logs (regex)"><small id="drpp-log-count">0 entries</small></div>
<p id="drpp-log-error" role="status" hidden></p><div id="drpp-log-lines" tabindex="0" aria-label="Recent app events" class="drpp-log-lines" role="log" aria-live="off"></div>
</aside></div><dialog id="drpp-info" aria-labelledby="drpp-info-title"><div class="drpp-info-heading"><h2 id="drpp-info-title">Info</h2><button type="button" id="drpp-info-close" aria-label="Close Info">×</button></div><div class="drpp-info-tabs" role="tablist" aria-label="Project information"><button type="button" role="tab" id="drpp-info-attribution" aria-controls="drpp-info-content" data-file="NOTICE" tabindex="0" aria-selected="true">OSS Attribution</button><button type="button" role="tab" id="drpp-info-readme" aria-controls="drpp-info-content" data-file="README.md" tabindex="-1" aria-selected="false">Readme</button><button type="button" role="tab" id="drpp-info-license" aria-controls="drpp-info-content" data-file="LICENSE" tabindex="-1" aria-selected="false">License</button></div><pre id="drpp-info-content" role="tabpanel" tabindex="0" aria-live="polite">Loading...</pre></dialog><script src="/settings.js"></script></body></html>
`;

const CSS = `${SERVER_CSS}
ul.plain{list-style:none;padding:0;margin:0 0 12px}ul.plain li{margin:0 0 6px}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 12px}.row label[for]{min-width:184px;color:#555}
select{font:inherit;padding:4px 8px;border:1px solid #888;border-radius:6px;background:#fff;color:inherit}
.hint{color:#555;font-size:13px;margin:0 0 12px}.hint a{color:inherit}
fieldset{border:0;padding:0;margin:0 0 4px}legend{padding:0;margin:0 0 8px;color:#555}
input[type=number]{font:inherit;width:6em;padding:4px 8px;border:1px solid #888;border-radius:6px;background:#fff;color:inherit}
input[type=range]{width:180px;accent-color:#0b5cad}output{min-width:3.5em;font-variant-numeric:tabular-nums;color:#555}.unit{color:#555;font-size:13px}
.preview{margin:4px 0 12px;padding:12px;border:1px dashed #bbb;border-radius:6px;overflow-x:auto}.preview-label{margin:0 0 8px;color:#555;font-size:13px}.preview img{display:block;max-width:100%;height:auto}.preview img[hidden]{display:none}
code.secret{letter-spacing:.05em}
dl{margin:0 0 12px}code{font:12px/1.4 Consolas,monospace;overflow-wrap:anywhere}button[disabled]{opacity:.6;cursor:default}
@media (max-width:520px){.row label[for]{flex-basis:100%;min-width:0}}
@media (prefers-color-scheme:dark){select,input[type=number]{background:#2c2c31;border-color:#555}.row label[for],.hint,legend,output,.unit,.preview-label{color:#aaa}input[type=range]{accent-color:#7ab8ff}.preview{border-color:#555}}
`;

// DRPP v3.4.0 layout port: full-height header, 50/50 editor/log panels,
// separated accordions and a log toolbar. Keep all settings writes on the
// existing NowPlaying forms; no Plex-only controls are presented as working.
const DRPP_SHELL_CSS = `html.drpp-root{color-scheme:dark}
.drpp-shell .drpp-skip{position:fixed;top:-60px;left:12px;background:#242424;color:#f1f3f5;padding:8px 12px;border:2px solid #bda0f8;z-index:20}.drpp-shell .drpp-skip:focus{top:12px}
.drpp-shell #hosted-details[hidden]{display:none}
.drpp-shell input[type=range]{accent-color:#7ab8ff}
.drpp-shell #hosted-devices{overflow-wrap:anywhere}
.drpp-shell :focus-visible{outline:2px solid #bda0f8;outline-offset:3px}.drpp-shell .drpp-config-scroll:focus-visible,.drpp-shell .drpp-log-lines:focus-visible{outline-offset:-3px}
.drpp-shell #drpp-info-content:focus-visible{outline-offset:-3px}
body.drpp-shell{color-scheme:dark;margin:0;background:#242424;color:#c1c2c5;font:14px/1.55 system-ui, sans-serif}
.drpp-shell #discovered-list li,.drpp-shell #servers-list li,.drpp-shell #signin-panel,.drpp-shell #services-section>div{border-color:#373a40}
.drpp-shell *{box-sizing:border-box}.drpp-shell .drpp-header{min-height:78px;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px;border-bottom:1px solid #373a40}
.drpp-heading,.drpp-actions,.drpp-panel-heading{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.drpp-shell h1{font-size:20px;line-height:1.3;margin:0;color:#f1f3f5}.drpp-shell h2{font-size:18px;line-height:1.3;margin:0;color:#f1f3f5}
.drpp-divider{height:26px;width:1px;background:#373a40;flex:none}.drpp-actions a{padding:8px 12px;border:1px solid #373a40;border-radius:4px;text-decoration:none;color:inherit}.drpp-actions a:hover{background:#2e2e2e}
.drpp-shell button,.drpp-shell select,.drpp-shell input[type=number],.drpp-shell input[type=search],.drpp-shell input[type=text],.drpp-shell input[type=url],.drpp-shell input[type=password],.drpp-shell input:not([type]){font:inherit;background:#2e2e2e;color:#c1c2c5;border:1px solid #373a40;border-radius:4px;padding:7px 12px}
.drpp-shell input:not([type=checkbox]):not([type=range]),.drpp-shell select{border-color:#858990}
.drpp-shell input::placeholder{color:#a8a9ae;opacity:1}
.drpp-shell .ok{color:#7ab8ff}.drpp-shell .bad{color:#ffa552;font-weight:600}.drpp-shell .warn{color:#e0d070}
.drpp-shell #card-font-error{color:#ffa552;margin:0 0 12px}.drpp-shell #card-font-help{color:#a8a9ae}.drpp-shell #card-fontStack{max-width:100%}
.drpp-shell button:not(:disabled){cursor:pointer}.drpp-shell button:disabled{opacity:.55}.drpp-shell button[type=submit]{background:#1971c2;color:white;border-color:#1971c2}
.drpp-columns{display:flex;height:calc(100vh - 79px);min-height:0}.drpp-config,.drpp-logs{width:50%;min-width:0;display:flex;flex-direction:column}
.drpp-config{max-width:none;padding:0;margin:0;border-right:1px solid #373a40}.drpp-panel-heading{padding:16px;min-height:69px;border-bottom:1px solid #373a40;flex:none}
.drpp-config-scroll,.drpp-log-lines{overflow:auto;min-height:0;flex:1}.drpp-config-scroll{padding:16px}.drpp-port-note{color:#909296;margin:0 0 16px}
.drpp-config .drpp-setup[hidden]{display:none}.drpp-config .drpp-setup{width:min(100%,305px);border:1px solid #373a40;border-radius:4px;padding:16px;margin:0 0 16px;color:#c1c2c5}
.drpp-setup-title{display:flex;align-items:center;gap:8px}.drpp-setup-title span{color:#ffa552}.drpp-setup p{margin:8px 0 12px}.drpp-setup a{display:block;background:#1971c2;color:white!important;padding:7px 12px;border-radius:4px;text-align:center;text-decoration:none;font-weight:600}
.drpp-setup a:hover{background:#1864ab}
.drpp-config .drpp-accordion[hidden]{display:none}.drpp-config .drpp-accordion{display:block;margin:0 0 16px;background:#242424;border:1px solid #373a40;border-radius:4px;padding:0}
.drpp-config .drpp-accordion>summary{cursor:pointer;list-style:none;padding:12px 16px;color:#f1f3f5;font-weight:500;display:flex;align-items:center;justify-content:space-between}
.drpp-config .drpp-accordion>summary::-webkit-details-marker{display:none}.drpp-config .drpp-accordion>summary::after{content:"⌄";font-size:18px;line-height:1;color:#909296}.drpp-config .drpp-accordion[open]>summary::after{content:"⌃"}
.drpp-config .drpp-accordion[open]>summary{border-bottom:1px solid #373a40}.drpp-config .drpp-accordion section>h2{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.drpp-config .drpp-accordion section{background:transparent;border:0;border-radius:0;margin:0;padding:16px}.drpp-config section h2{margin:0 0 8px}.drpp-config section[hidden],.drpp-config form[hidden]{display:none}
.drpp-config .hint,.drpp-config legend,.drpp-config .row label[for],.drpp-config dt,.drpp-config output,.drpp-config .unit,.drpp-config .preview-label{color:#a8a9ae}.drpp-config a{color:#74c0fc}.drpp-config .preview{border-color:#373a40}
.drpp-logs .drpp-panel-heading{gap:12px}.drpp-panel-heading label{white-space:nowrap}.drpp-panel-heading input[type=search]{flex:1;min-width:125px}.drpp-panel-heading small{color:#909296;white-space:nowrap}
.drpp-indicator{width:9px;height:9px;background:#868e96;border-radius:50%;flex:none}.drpp-indicator.connected{background:#7ab8ff}.drpp-indicator.disconnected{background:#ffa552}
.drpp-log-lines{font:13px/1.6 ui-monospace,Consolas,monospace}.drpp-log-line{padding:1px 8px;border-left:4px solid #7ab8ff;background:rgba(79,70,229,.05);white-space:pre;word-break:break-all}.drpp-log-line.warn{border-color:#f59e0b}.drpp-log-line.error{border-color:#ffa552}.drpp-log-line .timestamp{color:#a1a5af}.drpp-log-line .level{color:#7ab8ff}.drpp-log-line.warn .level{color:#f59e0b}.drpp-log-line.error .level{color:#ffa552}.drpp-log-line .source{color:#60a5fa}
.drpp-log-lines.wrap .drpp-log-line{white-space:pre-wrap}.drpp-logs #drpp-log-error{padding:8px 16px;color:#ffa552}
#drpp-info{width:75%;max-width:1100px;max-height:85vh;margin:auto;background:#242424;color:#c1c2c5;border:1px solid #373a40;border-radius:8px;padding:0;box-shadow:0 20px 60px #0009}
#drpp-info::backdrop{background:#0009}.drpp-info-heading{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid #373a40}.drpp-info-heading h2{margin:0}.drpp-info-tabs{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid #373a40;overflow-x:auto}.drpp-info-tabs button[aria-selected=true]{color:#f1f3f5;border-color:#1971c2;background:#263b50}#drpp-info-content{margin:0;padding:16px;max-height:60vh;overflow:auto;background:#242424;color:#c1c2c5;border:0;white-space:pre-wrap;word-break:break-word;font:13px/1.5 ui-monospace,Consolas,monospace}
@media(max-width:900px){#drpp-info{width:95%}.drpp-columns{height:auto;flex-direction:column}.drpp-config,.drpp-logs{width:100%;border-right:0}.drpp-config-scroll{max-height:65vh}.drpp-log-lines{min-height:250px;max-height:45vh}.drpp-header{flex-wrap:wrap}}
`;

const buildDrppShellScript = (startupCopy) => `"use strict";
// A bounded poll of the existing safe JSON log API; DRPP uses SSE, which
// NowPlaying does not expose. No network request leaves loopback.
const optionalSections = ["privacy-form", "card-form", "youtube-section", "startup-form", "hosted-devices"];
function syncAccordionVisibility() {
  for (const id of optionalSections) {
    const section = document.getElementById(id);
    if (section) section.parentElement.hidden = section.hidden;
  }
}
const visibilityObserver = new MutationObserver(syncAccordionVisibility);
for (const id of optionalSections) {
  const section = document.getElementById(id);
  if (section) visibilityObserver.observe(section, { attributes: true, attributeFilter: ["hidden"] });
}
syncAccordionVisibility();
const lines = document.getElementById("drpp-log-lines");
const indicator = document.getElementById("drpp-log-indicator");
const search = document.getElementById("drpp-search");
const count = document.getElementById("drpp-log-count");
const error = document.getElementById("drpp-log-error");
const autoScroll = document.getElementById("drpp-auto-scroll");
const wrap = document.getElementById("drpp-wrap");
// DRPP stores these display preferences locally. They do not change the app's
// settings or send any log data outside this page.
function storedLogPreference(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch { return fallback; }
}
function saveLogPreference(key, value) {
  try { localStorage.setItem(key, String(value)); } catch {}
}
autoScroll.checked = storedLogPreference("logs-auto-scroll", true);
wrap.checked = storedLogPreference("logs-wrap-text", false);
lines.classList.toggle("wrap", wrap.checked);
let entries = [];
let logConnectionError = "";
function renderLogs() {
  let match;
  try {
    const text = search.value.trim();
    const lastSlash = text.lastIndexOf("/");
    match = !text ? null : text.startsWith("/") && lastSlash > 0
      ? new RegExp(text.slice(1, lastSlash), text.slice(lastSlash + 1))
      : new RegExp(text);
    search.removeAttribute("aria-invalid"); error.textContent = logConnectionError; error.hidden = !logConnectionError;
  } catch { search.setAttribute("aria-invalid", "true"); error.textContent = "[Search] Invalid search expression"; error.hidden = false; return; }
  const shown = entries.filter((e) => {
    if (!match) return true;
    match.lastIndex = 0; // /g and /y patterns must start at the beginning for every log row.
    return match.test([e.time, "[" + e.level + "]", "[" + e.component + "]", e.status, e.code].join(" "));
  });
  count.textContent = shown.length + (shown.length === 1 ? " entry" : " entries") + (shown.length !== entries.length ? " (" + entries.length + " total)" : "");
  lines.replaceChildren(...shown.map((e) => {
    const line = document.createElement("div"); line.className = "drpp-log-line " + (e.level === "warn" || e.level === "error" ? e.level : "");
    for (const [cls, text] of [["timestamp", e.time], ["level", "[" + e.level.toUpperCase() + "]"], ["source", "[" + e.component + "]"]]) {
      const span = document.createElement("span"); span.className = cls; span.textContent = text || ""; line.append(span, " ");
    }
    line.append(e.status + (e.code ? " (" + e.code + ")" : "")); return line;
  }));
  if (autoScroll.checked) lines.scrollTop = lines.scrollHeight;
}
async function refreshLogs() {
  try {
    const res = await fetch("/api/logs", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error();
    const data = await res.json(); logConnectionError = ""; entries = Array.isArray(data.events) ? data.events.slice(-1000) : [];
    indicator.className = "drpp-indicator connected"; indicator.setAttribute("aria-label", "Log connection active"); renderLogs();
  } catch {
    indicator.className = "drpp-indicator disconnected"; indicator.setAttribute("aria-label", "Log connection unavailable");
    logConnectionError = "Can't reach the log. Displayed events may be out of date."; error.textContent = logConnectionError; error.hidden = false;
  }
}
search.addEventListener("input", renderLogs);
wrap.addEventListener("change", () => { lines.classList.toggle("wrap", wrap.checked); saveLogPreference("logs-wrap-text", wrap.checked); });
autoScroll.addEventListener("change", () => { saveLogPreference("logs-auto-scroll", autoScroll.checked); renderLogs(); });
// DRPP AutostartSwitch: lives in the Configuration toolbar and writes the
// same startup setting as the Startup section below. Hidden until the app
// reports that startup control is available on this install.
const autostartWrap = document.getElementById("drpp-autostart-wrap");
const autostartDivider = document.getElementById("drpp-autostart-divider");
const autostartBox = document.getElementById("drpp-autostart");
const autostartResult = document.getElementById("drpp-autostart-result");
// Both startup controls - this switch and the Startup section below - render
// from the same returned startup state, so a save in either place leaves the
// other in sync, including the repair note.
function applyStartupState(startup) {
  if (!startup || !startup.available) { autostartWrap.hidden = autostartDivider.hidden = true; return; }
  autostartWrap.hidden = autostartDivider.hidden = false;
  autostartBox.checked = startup.enabled === true;
  autostartResult.textContent = startup.broken ? "${startupCopy.toolbarRepair}" : "";
  const sectionBox = document.getElementById("startup-enabled");
  if (sectionBox) sectionBox.checked = startup.enabled === true;
}
async function loadAutostart() {
  try {
    const res = await fetch("/api/settings", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return;
    applyStartupState((await res.json()).startup);
  } catch {}
}
autostartBox.addEventListener("change", async () => {
  const wanted = autostartBox.checked;
  autostartBox.disabled = true;
  autostartResult.textContent = "";
  try {
    const res = await fetch("/api/settings", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ startup: { enabled: wanted } }) });
    if (!res.ok) throw new Error();
    applyStartupState((await res.json()).startup);
  } catch {
    autostartBox.checked = !wanted;
    autostartResult.textContent = "Couldn't save. Nothing was changed.";
  } finally {
    autostartBox.disabled = false;
  }
});
loadAutostart();
async function refreshVersion() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) throw new Error();
    const status = await res.json();
    document.getElementById("drpp-version").textContent = "Version: v" + status.version;
    const notice = document.getElementById("drpp-setup");
    const state = status.server?.state;
    const rows = Array.isArray(status.servers) ? status.servers : [];
    const failedServer = rows.some((row) => row.state === "error" || row.state === "unavailable");
    const checking = !failedServer && state === "starting";
    const recovered = state === "connected" && !failedServer;
    if (recovered && document.activeElement && notice.contains(document.activeElement)) document.getElementById("settings-content").focus();
    notice.hidden = recovered;
    if (!notice.hidden) {
      const unconfigured = !status.server?.type || state === "safe_mode";
      document.getElementById("drpp-setup-title").textContent = unconfigured ? "Setup Incomplete" : checking ? "Checking Servers" : "Server Needs Attention";
      document.getElementById("drpp-setup-message").textContent = unconfigured ? "Add a media server to finish setting up." : checking ? "Checking the media server connection..." : "Check the media server connection below.";
      document.getElementById("drpp-setup-action").textContent = unconfigured ? "Add Server" : "Check Server";
    }
  } catch { document.getElementById("drpp-version").textContent = "Version unavailable"; }
}
// Setup notice navigation must also work after Media servers is collapsed.
document.getElementById("drpp-setup-action").addEventListener("click", (event) => {
  event.preventDefault();
  document.getElementById("servers-section").closest("details").open = true;
  document.getElementById("scan-subnet").focus();
});
// DRPP InfoModal: local, read-only NOTICE/README/LICENSE tabs.
const infoDialog = document.getElementById("drpp-info");
const infoContent = document.getElementById("drpp-info-content");
const infoTabs = Array.from(document.querySelectorAll("#drpp-info [role=tab]"));
const infoCache = new Map();
let infoRequest = 0;
async function selectInfoTab(tab) {
  for (const item of infoTabs) { item.setAttribute("aria-selected", String(item === tab)); item.setAttribute("tabindex", item === tab ? "0" : "-1"); }
  infoContent.setAttribute("aria-labelledby", tab.id);
  infoContent.scrollTop = 0;
  const filename = tab.dataset.file;
  const request = ++infoRequest;
  if (infoCache.has(filename)) { infoContent.textContent = infoCache.get(filename); return; }
  infoContent.textContent = "Loading...";
  try {
    const res = await fetch("/api/info/" + filename, { cache: "no-store", headers: { Accept: "text/plain" } });
    if (!res.ok) throw new Error();
    const text = await res.text();
    infoCache.set(filename, text);
    if (request === infoRequest) infoContent.textContent = text;
  } catch { if (request === infoRequest) infoContent.textContent = "Could not load this file."; }
}
document.getElementById("drpp-info-open").addEventListener("click", () => { infoDialog.showModal(); selectInfoTab(infoTabs[0]); });
document.getElementById("drpp-info-close").addEventListener("click", () => infoDialog.close());
for (const tab of infoTabs) {
  tab.addEventListener("click", () => selectInfoTab(tab));
  tab.addEventListener("keydown", (event) => {
    const index = infoTabs.indexOf(tab);
    const next = event.key === "ArrowRight" ? (index + 1) % infoTabs.length : event.key === "ArrowLeft" ? (index + infoTabs.length - 1) % infoTabs.length : event.key === "Home" ? 0 : event.key === "End" ? infoTabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    infoTabs[next].focus();
    selectInfoTab(infoTabs[next]);
  });
}
refreshVersion(); refreshLogs(); setInterval(refreshLogs, 3000); setInterval(refreshVersion, 15000);
`;

const buildScript = (startupCopy) => `"use strict";
const form = document.getElementById("discord-form");
const fields = { enabled: document.getElementById("discord-enabled"), timestamps: document.getElementById("discord-timestamps"), artworkLookup: document.getElementById("discord-artwork"), artworkUpload: document.getElementById("discord-upload"), idleBehavior: document.getElementById("discord-idle") };
const save = document.getElementById("discord-save");
function say(text, tone) { const el = document.getElementById("discord-result"); el.textContent = text; el.className = tone || ""; }
function show(d) { fields.enabled.checked = d.enabled; fields.timestamps.value = d.timestamps; fields.artworkLookup.value = d.artworkLookup; fields.artworkUpload.checked = d.artworkUpload !== false; fields.idleBehavior.value = d.idleBehavior || "clear"; toggle(); }
function toggle() { fields.timestamps.disabled = fields.artworkLookup.disabled = fields.artworkUpload.disabled = fields.idleBehavior.disabled = !fields.enabled.checked; }
fields.enabled.addEventListener("change", toggle);
async function load() {
  try {
    const res = await fetch("/api/settings", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const all = await res.json();
    show(all.discord);
    showHosted(all.hosted);
    showStartup(all.startup);
    showPrivacy(all.privacy);
    savedCard = all.card || null;
    showCard(all.card);
    if (hostedCard) showHosted(hostedCard);
  } catch {
    say("Can't load settings. NowPlaying may have been closed.", "bad");
    save.disabled = true;
  }
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const restoreSaveFocus = document.activeElement === save;
  save.disabled = true;
  say("Saving...", "warn");
  try {
    const body = { discord: { enabled: fields.enabled.checked, timestamps: fields.timestamps.value, artworkLookup: fields.artworkLookup.value, artworkUpload: fields.artworkUpload.checked, idleBehavior: fields.idleBehavior.value } };
    const res = await fetch("/api/settings", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(String(res.status));
    show((await res.json()).discord);
    say("Saved. Discord is using the new settings.", "ok");
  } catch {
    say("Couldn't save. Nothing was changed.", "bad");
  } finally {
    save.disabled = false;
    if (restoreSaveFocus && document.activeElement === document.body) save.focus();
  }
});
document.getElementById("refresh-art").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const result = document.getElementById("refresh-result");
  const restoreButtonFocus = document.activeElement === button;
  button.disabled = true;
  result.textContent = "Refreshing..."; result.className = "warn";
  try {
    const res = await fetch("/api/settings/discord/refresh-artwork", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}" });
    if (!res.ok) throw new Error(String(res.status));
    await res.json();
    result.textContent = fields.enabled.checked ? "Done. Discord will show the new cover in a moment." : "Done. Covers are looked up again when Discord is on.";
    result.className = "ok";
  } catch {
    result.textContent = "Couldn't refresh.";
    result.className = "bad";
  } finally {
    button.disabled = false;
    if (restoreButtonFocus && document.activeElement === document.body) button.focus();
  }
});
const PRIVACY_KEYS = ["hideTitles", "hideArtwork", "hideProgress", "hideMovies", "hideEpisodes", "hideMusic"];
const privacy = { form: document.getElementById("privacy-form"), save: document.getElementById("privacy-save") };
function privacySay(text, tone) { const el = document.getElementById("privacy-result"); el.textContent = text; el.className = tone || ""; }
function showPrivacy(p) { privacy.form.hidden = !p; if (p) for (const key of PRIVACY_KEYS) document.getElementById("privacy-" + key).checked = p[key] === true; }
privacy.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const restoreSaveFocus = document.activeElement === privacy.save;
  privacy.save.disabled = true;
  privacySay("Saving...", "warn");
  try {
    const body = { privacy: Object.fromEntries(PRIVACY_KEYS.map((key) => [key, document.getElementById("privacy-" + key).checked])) };
    const res = await fetch("/api/settings", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(String(res.status));
    showPrivacy((await res.json()).privacy);
    privacySay("Saved. Applies from the next update.", "ok");
  } catch {
    privacySay("Couldn't save. Nothing was changed.", "bad");
  } finally {
    privacy.save.disabled = false;
    if (restoreSaveFocus && document.activeElement === document.body) privacy.save.focus();
  }
});
const CARD_DEFAULTS = { theme: "midnight-blue", width: 440, padding: 24, radius: 10, progressHeight: 4, showProgress: true, artworkPosition: "left", artworkWidth: null, artworkHeight: null, fieldOrder: ["state", "title", "subtitle"], textAlign: "start", progressPosition: "bottom", progressWidth: "content", direction: "ltr", fontFamily: "system", statusStyle: "plain", artShape: "square", progressStyle: "square", border: "thin", background: "solid", fontStack: "" };
const LOOK_KEYS = ["fontFamily", "statusStyle", "artShape", "progressStyle", "border", "background", "fontStack"];
const CARD_NUMBERS = { width: [280, 800], padding: [12, 48], radius: [0, 24], progressHeight: [2, 12], artworkWidth: [48, 160], artworkHeight: [48, 180] };
const card = { form: document.getElementById("card-form"), save: document.getElementById("card-save"), preview: document.getElementById("card-preview"), note: document.getElementById("card-preview-note"), scaleNote: document.getElementById("card-artwork-scale-note") };
const cardField = (key) => document.getElementById("card-" + key);
// Artwork size stays automatic (picked by media kind) until a slider moves.
const ART_AUTO = { artworkWidth: true, artworkHeight: true };
const ART_SHOWN = { artworkWidth: 100, artworkHeight: 100 };
function cardSay(text, tone) { const el = document.getElementById("card-result"); el.textContent = text; el.className = tone || ""; }
function cardValues() {
  const values = { theme: cardField("theme").value, showProgress: cardField("showProgress").checked, artworkPosition: cardField("artworkPosition").value, fieldOrder: cardField("fieldOrder").value.split(","), textAlign: cardField("textAlign").value, progressPosition: cardField("progressPosition").value, progressWidth: cardField("progressWidth").value, direction: cardField("direction").value, fontFamily: cardField("fontFamily").value, statusStyle: cardField("statusStyle").value, artShape: cardField("artShape").value, progressStyle: cardField("progressStyle").value, border: cardField("border").value, background: cardField("background").value, fontStack: cardField("fontStack").value.trim() };
  for (const key of Object.keys(CARD_NUMBERS)) values[key] = ART_AUTO[key] ? null : Number(cardField(key).value);
  return values;
}
function customFontValid(value) {
  return !value || (value.length <= 80 && /^[A-Za-z0-9][A-Za-z0-9 .-]*(,\\s*[A-Za-z0-9][A-Za-z0-9 .-]*){0,4}$/.test(value));
}
function cardValid(values) {
  return customFontValid(values.fontStack) && Object.entries(CARD_NUMBERS).every(([key, [min, max]]) => (ART_AUTO[key] && values[key] === null) || (Number.isInteger(values[key]) && values[key] >= min && values[key] <= max));
}
// Read the actual SVG returned for this preview, not an assumed media kind:
// live movies and episodes use different automatic artwork widths from tracks.
function previewArtworkScale(svg, selectedWidth) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.localName !== "svg") throw new Error("Invalid preview");
  const image = doc.querySelector("image");
  if (!image) return null;
  const rendered = Number(image.getAttribute("width"));
  const requested = selectedWidth ?? (doc.documentElement.getAttribute("data-preview-artwork-width") ? Number(doc.documentElement.getAttribute("data-preview-artwork-width")) : rendered);
  return Number.isFinite(rendered) && Number.isFinite(requested) && rendered < requested ? { requested, rendered } : null;
}
let previewTimer;
let previewRequest;
let previewObjectUrl;
let previewGeneration = 0;
function cardChanged() {
  for (const key of ["padding", "radius", "progressHeight", "artworkWidth", "artworkHeight"]) document.getElementById("card-" + key + "-value").textContent = ART_AUTO[key] ? "Auto" : cardField(key).value + " px";
  for (const key of ["padding", "radius", "progressHeight", ...Object.keys(ART_AUTO)]) cardField(key).setAttribute("aria-valuetext", ART_AUTO[key] ? "Auto" : cardField(key).value + " px");
  for (const key of ["progressHeight", "progressPosition", "progressWidth", "progressStyle"]) cardField(key).disabled = !cardField("showProgress").checked;
  clearTimeout(previewTimer);
  previewGeneration++;
  if (previewRequest) previewRequest.abort();
  card.scaleNote.hidden = true;
  previewTimer = setTimeout(async () => {
    const values = cardValues();
    cardField("width").setAttribute("aria-invalid", String(!Number.isInteger(values.width) || values.width < CARD_NUMBERS.width[0] || values.width > CARD_NUMBERS.width[1]));
    const fontInvalid = !customFontValid(values.fontStack);
    const fontError = document.getElementById("card-font-error");
    fontError.hidden = !fontInvalid;
    fontError.textContent = fontInvalid ? "Use up to 5 plain font names separated by commas, without quotes or semicolons (80 characters max)." : "";
    cardField("fontStack").setAttribute("aria-invalid", String(fontInvalid));
    if (!cardValid(values)) { cardSay(fontInvalid ? fontError.textContent : "Width must be a whole number from 280 to 800.", "bad"); card.save.disabled = true; return; }
    card.save.disabled = false;
    if (document.getElementById("card-result").className === "bad") cardSay("");
    const query = new URLSearchParams({ ...values, showProgress: values.showProgress ? "1" : "0", fieldOrder: values.fieldOrder.join(",") });
    for (const key of Object.keys(ART_AUTO)) if (values[key] === null) query.delete(key);
    const request = new AbortController();
    const generation = previewGeneration;
    previewRequest = request;
    try {
      const response = await fetch("/api/settings/card/preview.svg?" + query, { signal: request.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Preview unavailable");
      const svg = await response.text();
      if (request.signal.aborted || generation !== previewGeneration) return;
      const scale = previewArtworkScale(svg, values.artworkWidth);
      card.scaleNote.textContent = scale ? "Preview artwork is " + scale.rendered + " px wide (" + scale.requested + " px selected) to keep the text readable. Your selected width is still saved." : "";
      const objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      card.preview.onload = () => {
        if (generation !== previewGeneration) { URL.revokeObjectURL(objectUrl); return; }
        if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = objectUrl;
        card.preview.hidden = false;
        card.note.hidden = true;
        card.scaleNote.hidden = !card.scaleNote.textContent;
      };
      card.preview.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        if (generation !== previewGeneration) return;
        card.preview.hidden = true;
        card.note.hidden = false;
        card.scaleNote.hidden = true;
      };
      card.preview.src = objectUrl;
    } catch (error) {
      if (request.signal.aborted || generation !== previewGeneration) return;
      card.preview.hidden = true;
      card.note.hidden = false;
      card.scaleNote.hidden = true;
    }
  }, 200);
}
function showCard(c) {
  card.form.hidden = !c;
  if (!c) return;
  cardField("theme").value = c.theme;
  cardField("showProgress").checked = c.showProgress;
  cardField("artworkPosition").value = c.artworkPosition;
  cardField("fieldOrder").value = c.fieldOrder.join(",");
  cardField("textAlign").value = c.textAlign;
  cardField("progressPosition").value = c.progressPosition;
  cardField("progressWidth").value = c.progressWidth;
  cardField("direction").value = c.direction;
  for (const key of LOOK_KEYS) cardField(key).value = c[key];
  for (const key of Object.keys(CARD_NUMBERS)) {
    if (Object.hasOwn(ART_AUTO, key)) ART_AUTO[key] = c[key] === null;
    cardField(key).value = c[key] ?? ART_SHOWN[key];
  }
  cardChanged();
}
// Registered before cardChanged so a single click or arrow key leaves Auto
// before the size is read, without relying on capture order (#480 review).
for (const key of Object.keys(ART_AUTO)) cardField(key).addEventListener("input", () => { ART_AUTO[key] = false; });
for (const key of ["theme", "width", "padding", "radius", "progressHeight", "showProgress", "artworkPosition", "artworkWidth", "artworkHeight", "fieldOrder", "textAlign", "progressPosition", "progressWidth", "direction", ...LOOK_KEYS]) cardField(key).addEventListener("input", cardChanged);
cardField("theme").addEventListener("change", () => {
  // Compact hides the bar by default; the others show it.
  cardField("showProgress").checked = cardField("theme").value !== "compact";
  cardChanged();
});
document.getElementById("card-reset").addEventListener("click", () => { showCard(CARD_DEFAULTS); cardSay("Defaults shown. Press Save to keep them.", ""); });
card.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = cardValues();
  if (!cardValid(values)) return;
  const restoreSaveFocus = document.activeElement === card.save;
  card.save.disabled = true;
  cardSay("Saving...", "warn");
  try {
    const saved = (await send("/api/settings", "PUT", { card: values })).card;
    savedCard = saved;
    showCard(saved);
    if (hostedCard) showHosted(hostedCard);
    cardSay("Saved. Your card uses these settings now.", "ok");
  } catch {
    cardSay("Couldn't save. Nothing was changed.", "bad");
  } finally {
    card.save.disabled = false;
    if (restoreSaveFocus && document.activeElement === document.body) card.save.focus();
  }
});
// YouTube extension pairing (#136). The code is fetched with POST so the
// session check applies; it stays hidden until "Show code".
const youtube = { section: document.getElementById("youtube-section"), code: document.getElementById("youtube-token"), show: document.getElementById("youtube-show"), token: "", shown: false };
function youtubeSay(text, tone) { const el = document.getElementById("youtube-result"); el.textContent = text; el.className = tone || ""; }
function youtubeRender() {
  youtube.show.disabled = document.getElementById("youtube-copy").disabled = !youtube.token;
  youtube.code.textContent = youtube.shown ? youtube.token : "\u2022".repeat(16);
  youtube.code.className = youtube.shown ? "" : "secret";
  youtube.show.textContent = youtube.shown ? "Hide code" : "Show code";
  youtube.show.setAttribute("aria-pressed", String(youtube.shown));
}
async function youtubeFetch(path) {
  const res = await fetch(path, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(String(res.status));
  const body = await res.json();
  if (typeof body.token !== "string" || !body.token) throw new Error("no token");
  return body.token;
}
async function loadYouTube() {
  try {
    const token = await youtubeFetch("/api/settings/youtube/pairing");
    // 404: the bridge is off (safe mode), so there's nothing to pair with.
    if (token === null) { youtube.section.hidden = true; return; }
    youtube.token = token;
    document.getElementById("youtube-port").textContent = location.port || (location.protocol === "https:" ? "443" : "80");
    youtube.section.hidden = false;
    youtubeRender();
  } catch {
    youtube.section.hidden = false;
    youtubeSay("Can't load the pairing code. Reload the page to try again.", "bad");
  }
}
youtube.show.addEventListener("click", () => { youtube.shown = !youtube.shown; youtubeRender(); });
document.getElementById("youtube-copy").addEventListener("click", async () => {
  if (!youtube.token) return;
  try { await navigator.clipboard.writeText(youtube.token); youtubeSay("Copied. Paste it into the extension's options page.", "ok"); }
  catch { youtubeSay("Couldn't copy. Press Show code and copy it by hand.", "bad"); }
});
document.getElementById("youtube-reset").addEventListener("click", async (event) => {
  if (!confirm("Make a new pairing code? The old code stops working straight away, and the extension stops sending until you paste the new one.")) return;
  const button = event.currentTarget;
  button.disabled = true;
  youtubeSay("Making a new code...", "warn");
  try {
    const token = await youtubeFetch("/api/settings/youtube/pairing/reset");
    if (token === null) throw new Error("off");
    youtube.token = token;
    youtubeRender();
    youtubeSay("New code made. The old one no longer works. Paste this one into the extension.", "ok");
  } catch {
    youtubeSay("Couldn't make a new code. Reload the page to see which code is current.", "bad");
  } finally {
    button.disabled = false;
  }
});
loadYouTube();
// Servers (#253): the list comes from the status API; changes go through
// setup, which the app's tray session opens and then restarts the app.
const startup = { form: document.getElementById("startup-form"), enabled: document.getElementById("startup-enabled"), save: document.getElementById("startup-save") };
function startupSay(text, tone) { const el = document.getElementById("startup-result"); el.textContent = text; el.className = tone || ""; }
function showStartup(s) {
  startup.form.hidden = !s || !s.available;
  if (!s) return;
  startup.enabled.checked = s.enabled;
  startupSay(s.broken ? "${startupCopy.formRepair}" : "", s.broken ? "warn" : "");
}
startup.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const restoreSaveFocus = document.activeElement === startup.save;
  startup.save.disabled = true;
  startupSay("Saving...", "warn");
  try {
    const res = await fetch("/api/settings", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ startup: { enabled: startup.enabled.checked } }) });
    if (!res.ok) throw new Error(String(res.status));
    const updated = (await res.json()).startup;
    showStartup(updated);
    applyStartupState(updated);
    startupSay("Saved.", "ok");
  } catch {
    startupSay("Couldn't save. Nothing was changed.", "bad");
  } finally {
    startup.save.disabled = false;
    if (restoreSaveFocus && document.activeElement === document.body) startup.save.focus();
  }
});
const HOSTED_WORDS = { connected: ["Connected", "ok"], idle: ["Waiting for something to play", ""], retrying: ["Can't reach the service - retrying", "warn"], unauthorized: ["Signed out - save again to reconnect", "bad"], no_credentials: ["Not available in this build", "warn"], failed: ["Couldn't start", "bad"], safe_mode: ["Paused (safe mode)", "warn"], disconnect_pending: ["Uploads stopped; remote card deletion pending. Retry Disconnect this PC when online.", "bad"], off: ["Off", ""] };
// The hosted card takes its look from the link (#94, #414, #421). Only
// non-default settings are added. Artwork options are left out because the
// hosted card never draws artwork.
let hostedCard = null;
let savedCard = null;
function hostedLink(base) {
  if (!base || !savedCard) return base || "";
  const query = new URLSearchParams();
  if (savedCard.theme !== "midnight-blue") query.set("theme", savedCard.theme);
  if (savedCard.width !== 440) query.set("width", String(savedCard.width));
  if (savedCard.theme !== "compact" && !savedCard.showProgress) query.set("show", "mediaType,state,subtitle");
  const progressShown = savedCard.theme === "compact" ? savedCard.showProgress === true : savedCard.showProgress !== false;
  if (savedCard.padding !== undefined && savedCard.padding !== 24) query.set("padding", String(savedCard.padding));
  if (savedCard.radius !== undefined && savedCard.radius !== 10) query.set("radius", String(savedCard.radius));
  if (progressShown && savedCard.progressHeight !== undefined && savedCard.progressHeight !== 4) query.set("progressHeight", String(savedCard.progressHeight));
  if (savedCard.fieldOrder && savedCard.fieldOrder.join(",") !== "state,title,subtitle") query.set("fieldOrder", savedCard.fieldOrder.join(","));
  if (savedCard.textAlign && savedCard.textAlign !== "start") query.set("textAlign", savedCard.textAlign);
  if (progressShown && savedCard.progressPosition && savedCard.progressPosition !== "bottom") query.set("progressPosition", savedCard.progressPosition);
  if (progressShown && savedCard.progressWidth && savedCard.progressWidth !== "content") query.set("progressWidth", savedCard.progressWidth);
  if (savedCard.direction && savedCard.direction !== "ltr") query.set("direction", savedCard.direction);
  // artShape is left out: the hosted card never draws artwork.
  const LOOK_DEFAULTS = { fontFamily: "system", statusStyle: "plain", progressStyle: "square", border: "thin", background: "solid" };
  for (const [key, fallback] of Object.entries(LOOK_DEFAULTS)) if (savedCard[key] && savedCard[key] !== fallback) query.set(key, savedCard[key]);
  if (savedCard.fontStack) query.set("fontStack", savedCard.fontStack);
  const text = query.toString().replace(/%2C/g, ",");
  return text ? base + (base.includes("?") ? "&" : "?") + text : base;
}
const hosted = { form: document.getElementById("hosted-form"), enabled: document.getElementById("hosted-enabled"), save: document.getElementById("hosted-save"), disconnect: document.getElementById("hosted-disconnect") };
function hostedSay(text, tone) { const el = document.getElementById("hosted-result"); el.textContent = text; el.className = tone || ""; }
function showHosted(h) {
  if (!h) { hosted.form.hidden = true; return; }
  hosted.enabled.checked = h.enabled;
  const words = HOSTED_WORDS[h.state] || HOSTED_WORDS.failed;
  const state = document.getElementById("hosted-state");
  state.textContent = words[0]; state.className = words[1];
  hostedCard = h;
  const link = document.getElementById("hosted-url");
  const url = hostedLink(h.cardUrl);
  link.textContent = url || "Appears after the first upload";
  if (url) link.href = url;
  else link.removeAttribute("href");
  document.getElementById("hosted-markdown").textContent = url ? "![Now playing](" + url + ")" : "-";
  document.getElementById("copy-url").disabled = document.getElementById("copy-markdown").disabled = !h.cardUrl;
  const details = document.getElementById("hosted-details");
  const hideDetails = !h.enabled && h.state !== "disconnect_pending";
  if (hideDetails && document.activeElement && details.contains(document.activeElement)) hosted.enabled.focus();
  details.hidden = hideDetails;
  hosted.save.disabled = h.state === "disconnect_pending";
}
async function copy(id) {
  try { await navigator.clipboard.writeText(document.getElementById(id).textContent); hostedSay("Copied.", "ok"); }
  catch { hostedSay("Couldn't copy. Select the text instead.", "bad"); }
}
document.getElementById("copy-url").addEventListener("click", () => copy("hosted-url"));
document.getElementById("copy-markdown").addEventListener("click", () => copy("hosted-markdown"));
async function send(path, method, body) {
  const res = await fetch(path, { method, cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
hosted.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hosted.save.disabled = true;
  hostedSay("Saving...", "warn");
  try {
    showHosted((await send("/api/settings", "PUT", { hosted: { enabled: hosted.enabled.checked } })).hosted);
    hostedSay(hosted.enabled.checked ? "Saved. Uploads have started." : "Saved. Uploads have stopped.", "ok");
  } catch {
    hostedSay("Couldn't save. Nothing was changed.", "bad");
  } finally {
    hosted.save.disabled = false;
  }
});
hosted.disconnect.addEventListener("click", async () => {
  if (!confirm("Disconnect this PC from the hosted card? The service deletes its copy of your card. If you turn it on again, you get a new card link.")) return;
  hosted.disconnect.disabled = true;
  hostedSay("Disconnecting...", "warn");
  try {
    showHosted((await send("/api/settings/hosted/disconnect", "POST", {})).hosted);
    hostedSay("Disconnected. The service has deleted this PC's card.", "ok");
  } catch {
    let pending = false;
    try { const state = await fetch("/api/settings", { cache: "no-store", headers: { Accept: "application/json" } }); if (state.ok) { const view = (await state.json()).hosted; showHosted(view); pending = view.state === "disconnect_pending"; } } catch {}
    hostedSay(pending ? "Remote deletion is pending. This PC stopped uploading, but the old card may still be visible. Your saved key is kept so you can press Disconnect this PC again when you're online." : "Could not disconnect this PC. Check the hosted card status and try again.", "bad");
  } finally {
    hosted.disconnect.disabled = false;
  }
});
load();
`;

const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);
const MAX_BODY = 4096;
const PREVIEW_PATH = "/api/settings/card/preview.svg";
const PREVIEW_NUMBERS = new Set(["width", "padding", "radius", "progressHeight", "artworkWidth", "artworkHeight"]);

// Draft card settings from the preview URL. Values are checked again by
// normalizeCard, the same rules as a save.
function parsePreviewQuery(searchParams) {
  const card = {};
  for (const [key, value] of searchParams) {
    if (Object.hasOwn(card, key)) throw new TypeError("repeated");
    if (key === "theme") card.theme = value;
    else if (key === "showProgress" && (value === "1" || value === "0")) card.showProgress = value === "1";
    else if (key === "artworkPosition") card.artworkPosition = value;
    else if (["textAlign", "progressPosition", "progressWidth", "direction", "fontFamily", "statusStyle", "artShape", "progressStyle", "border", "background", "fontStack"].includes(key)) card[key] = value;
    else if (key === "fieldOrder") card.fieldOrder = value.split(",");
    else if (PREVIEW_NUMBERS.has(key) && /^\d{1,3}$/.test(value)) card[key] = Number(value);
    else throw new TypeError("bad preview query");
  }
  return normalizeCard(card);
}

export const OPEN_SETUP_PATH = "/api/settings/servers/setup";
export const YOUTUBE_PAIRING_PATH = "/api/settings/youtube/pairing";
export const YOUTUBE_PAIRING_RESET_PATH = "/api/settings/youtube/pairing/reset";

const SECTIONS = { discord: "updateDiscord", hosted: "updateHosted", startup: "updateStartup", privacy: "updatePrivacy", card: "updateCard" };

export function createSettingsPageHandler({ settings, fallback, platform = process.platform } = {}) {
  if (!settings || typeof settings.read !== "function" || typeof settings.updateDiscord !== "function") throw new TypeError("settings: expected read() and updateDiscord()");
  if (typeof fallback !== "function") throw new TypeError("fallback: expected a handler");
  // The startup section's wording is baked for this app's platform (#677).
  const startupCopy = startupCopyFor(platform);
  const pageHtml = buildPage(startupCopy);
  const scriptText = buildScript(startupCopy);
  const drppShellScriptText = buildDrppShellScript(startupCopy);
  const assets = {
    "/settings": { body: pageHtml, type: "text/html; charset=utf-8", page: true },
    "/servers.js": { body: SERVER_SCRIPT, type: "text/javascript; charset=utf-8" },
    "/settings.css": { body: CSS, type: "text/css; charset=utf-8" },
    "/drpp-shell.css": { body: DRPP_SHELL_CSS, type: "text/css; charset=utf-8" },
    "/settings.js": { body: `${scriptText}\n${HOSTED_DEVICES_SCRIPT}\n${SERVER_SCRIPT}\n${SERVICE_SCRIPT}\n${drppShellScriptText}`, type: "text/javascript; charset=utf-8" },
  };
  // Explicit allowlist only; project files ship alongside src in installed builds.
  const infoFiles = Object.fromEntries(["NOTICE", "README.md", "LICENSE"].map((name) => {
    try { return [name, readFileSync(new URL("../" + name, import.meta.url), "utf8")]; }
    catch { return [name, null]; }
  }));
  const read = async () => {
    const value = await settings.read();
    return { discord: value.discord, ...(value.hosted ? { hosted: value.hosted } : {}), ...(value.startup ? { startup: value.startup } : {}), ...(value.privacy ? { privacy: value.privacy } : {}), ...(value.card ? { card: value.card } : {}) };
  };
  async function preview(request, method, url) {
    if (typeof settings.previewCard !== "function") return response(404, "Not Found");
    if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
    const site = header(request?.headers, "sec-fetch-site");
    if (site !== undefined && !SAFE_FETCH_SITES.has(String(site).toLowerCase())) return response(403, "Forbidden");
    let card;
    try { card = parsePreviewQuery(url.searchParams); } catch { return response(400, "Invalid preview"); }
    let svg;
    try { svg = await settings.previewCard(card); } catch { svg = null; }
    if (typeof svg !== "string" || !svg.includes("<svg")) return response(503, "Preview unavailable", { "Cache-Control": "no-store" });
    return response(200, method === "HEAD" ? "" : svg, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  }
  // The old button opened a separate wizard. It is intentionally gone.
  async function openSetup() { return response(410, "Use Settings to add servers"); }
  // YouTube extension pairing token (#136). POST even for reading, so the
  // server's session check applies and only this app's own page gets the
  // token. Reset makes a new one.
  async function youtubePairing(request, method, reset) {
    const fn = reset ? settings.resetYouTubePairing : settings.youtubePairing;
    if (typeof fn !== "function") return response(404, "Not Found");
    if (method !== "POST") return response(405, "Method Not Allowed", { Allow: "POST" });
    const site = header(request?.headers, "sec-fetch-site");
    if (site !== undefined && !SAFE_FETCH_SITES.has(String(site).toLowerCase())) return response(403, "Forbidden");
    let result;
    try { result = await fn(); } catch { return json(500, { error: reset ? "reset_failed" : "read_failed" }); }
    if (typeof result?.token !== "string") return json(500, { error: "read_failed" });
    return json(200, { token: result.token });
  }
  return async function handle(request) {
    const method = request?.method || "GET";
    const url = new URL(request?.url || "/", "http://localhost");
    const asset = assets[url.pathname];
    if (url.pathname.startsWith("/api/info/")) {
      const name = url.pathname.slice("/api/info/".length);
      if (!Object.hasOwn(infoFiles, name)) return response(404, "Not Found");
      if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
      const site = header(request?.headers, "sec-fetch-site");
      if (site !== undefined && !SAFE_FETCH_SITES.has(String(site).toLowerCase())) return response(403, "Forbidden");
      const text = infoFiles[name];
      return text === null ? response(503, "File unavailable") : response(200, method === "HEAD" ? "" : text, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    }
    const disconnect = url.pathname === "/api/settings/hosted/disconnect";
    const refresh = url.pathname === "/api/settings/discord/refresh-artwork";
    if (url.pathname === PREVIEW_PATH) return preview(request, method, url);
    if (url.pathname === OPEN_SETUP_PATH) return openSetup(request, method);
    if (url.pathname === YOUTUBE_PAIRING_PATH || url.pathname === YOUTUBE_PAIRING_RESET_PATH) return youtubePairing(request, method, url.pathname === YOUTUBE_PAIRING_RESET_PATH);
    if (!asset && url.pathname !== "/api/settings" && !disconnect && !refresh) return fallback(request);
    if (asset) {
      if (method !== "GET" && method !== "HEAD") return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
      const result = response(200, method === "HEAD" ? "" : asset.body, { "Content-Type": asset.type, "Cache-Control": "no-store" });
      return asset.page ? { ...result, page: true } : result;
    }
    const action = disconnect || refresh;
    if (action ? method !== "POST" : method !== "GET" && method !== "PUT") return response(405, "Method Not Allowed", { Allow: action ? "POST" : "GET, PUT" });
    // Settings are for this app's own page: refuse other sites' requests.
    const site = header(request?.headers, "sec-fetch-site");
    if (site !== undefined && !SAFE_FETCH_SITES.has(String(site).toLowerCase())) return response(403, "Forbidden");
    if (method === "GET") return json(200, await read());
    if (refresh) {
      if (typeof settings.refreshArtwork !== "function") return response(404, "Not Found");
      let dropped;
      try { dropped = await settings.refreshArtwork(); } catch { return json(500, { error: "refresh_failed" }); }
      return json(200, { dropped: Number.isInteger(dropped) && dropped >= 0 ? dropped : 0 });
    }
    if (disconnect) {
      if (typeof settings.disconnectHosted !== "function") return response(404, "Not Found");
      try { await settings.disconnectHosted(); } catch { return json(502, { error: "disconnect_failed" }); }
      return json(200, await read());
    }
    let input;
    try {
      if (typeof request.body !== "string" || Buffer.byteLength(request.body) > MAX_BODY) throw new Error("body");
      input = JSON.parse(request.body);
    } catch {
      return json(400, { error: "invalid_json" });
    }
    const keys = input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : [];
    if (keys.length !== 1 || !Object.hasOwn(SECTIONS, keys[0]) || typeof settings[SECTIONS[keys[0]]] !== "function") return json(400, { error: "invalid_settings" });
    try {
      await settings[SECTIONS[keys[0]]](input[keys[0]]);
    } catch (error) {
      // Bad values are the caller's fault; anything else (disk, file) is ours.
      if (error instanceof TypeError || error instanceof RangeError) return json(400, { error: "invalid_settings" });
      return json(500, { error: "save_failed" });
    }
    return json(200, await read());
  };
}

function json(status, value) { return response(status, JSON.stringify(value), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); }
function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((value) => value.toLowerCase() === name);
  return key ? headers[key] : undefined;
}
function response(status, body, headers = {}) { return Object.freeze({ status, headers: Object.freeze(headers), body }); }

// No-config first run uses the same server panel and assets as configured Settings.
export function createFirstRunSettingsHandler({ servers } = {}) {
  if (typeof servers !== "function") throw new TypeError("servers handler required");
  const assets = { "/settings": [ONBOARDING_HTML, "text/html; charset=utf-8", true], "/settings.css": [CSS, "text/css; charset=utf-8"], "/status.css": ["body{font:15px/1.5 Segoe UI,system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px;background:#f6f6f8;color:#1b1b1f}section{background:#fff;padding:16px;border:1px solid #ddd;border-radius:8px;margin:16px 0}button{font:inherit;padding:6px 12px;cursor:pointer}@media(prefers-color-scheme:dark){body{background:#17171a;color:#eee}section{background:#222226;border-color:#444}}", "text/css; charset=utf-8"], "/servers.js": [`${SERVER_SCRIPT}\n${SERVICE_SCRIPT}`, "text/javascript; charset=utf-8"] };
  return async (request) => {
    const path = new URL(request?.url || "/", "http://127.0.0.1").pathname;
    if (path === "/") return { status: 302, headers: { Location: "/settings" }, body: "" };
    if (assets[path]) {
      if (!["GET", "HEAD"].includes(request?.method ?? "GET")) return response(405, "Method Not Allowed", { Allow: "GET, HEAD" });
      const [body, type, page] = assets[path];
      return { ...response(200, request?.method === "HEAD" ? "" : body, { "Content-Type": type }), ...(page ? { page: true } : {}) };
    }
    return servers(request);
  };
}
