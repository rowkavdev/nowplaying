// Push form for the GhostDeps device relay. Lanes open this page in the cloud
// browser and vault-fill the relay key; the page POSTs with it as a bearer.
export const RELAY_PUSH_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GhostDeps device relay - push</title>
<style>
  body { font-family: ui-monospace, monospace; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; background: #0d1117; color: #e6edf3; }
  label { display: block; margin: 1rem 0 0.25rem; font-size: 0.85rem; color: #9198a1; }
  input { width: 100%; box-sizing: border-box; padding: 0.5rem; background: #151b23; border: 1px solid #3d444d; color: #e6edf3; border-radius: 6px; font: inherit; }
  button { margin-top: 1.25rem; padding: 0.6rem 1.2rem; background: #238636; border: 0; border-radius: 6px; color: #fff; font: inherit; cursor: pointer; }
  #result { margin-top: 1rem; white-space: pre-wrap; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>GhostDeps device relay__CONFIGURED__</h1>
<form id="f" autocomplete="off">
  <label for="key">Relay key (vault: ghostdeps-device-relay)</label>
  <input id="key" name="password" type="password" autocomplete="current-password" required>
  <label for="code">Device code (XXXX-XXXX)</label>
  <input id="code" type="text" placeholder="8B4C-9D2E" required>
  <label for="lane">Lane</label>
  <input id="lane" type="text" placeholder="scanner-lane">
  <label for="scopes">Scopes</label>
  <input id="scopes" type="text" value="repo workflow gist read:org project">
  <label for="repo">Repo (optional)</label>
  <input id="repo" type="text" placeholder="rowkavdev/ghostdeps">
  <button type="submit">Push code</button>
</form>
<div id="result"></div>
<script>
document.getElementById("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const out = document.getElementById("result");
  out.textContent = "pushing...";
  try {
    const r = await fetch(location.pathname, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + document.getElementById("key").value },
      body: JSON.stringify({
        code: document.getElementById("code").value,
        lane: document.getElementById("lane").value,
        scopes: document.getElementById("scopes").value,
        repo: document.getElementById("repo").value,
      }),
    });
    out.textContent = r.status + " " + JSON.stringify(await r.json(), null, 2);
  } catch (e) { out.textContent = "failed: " + e; }
});
</script>
</body>
</html>`;
