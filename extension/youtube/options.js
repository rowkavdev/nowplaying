const form = document.getElementById("pair");
const status = document.getElementById("status");

function show(text, ok) {
  status.textContent = text;
  status.className = ok ? "ok" : "";
}

chrome.storage.local.get(["token", "port"]).then(({ token, port }) => {
  if (port) form.port.value = port;
  show(token ? "Paired." : "Not paired yet.", Boolean(token));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = form.token.value.trim();
  const port = Number(form.port.value) || 47832;
  if (token.length < 32) return show("That code is too short. Copy it again from the NowPlaying settings page.", false);
  await chrome.storage.local.set({ token, port });
  form.token.value = "";
  show("Paired.", true);
});

document.getElementById("forget").addEventListener("click", async () => {
  await chrome.storage.local.remove(["token"]);
  show("Unpaired. Nothing is sent now.", false);
});
