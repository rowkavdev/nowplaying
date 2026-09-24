const STEPS = Object.freeze(["welcome", "provider", "signin", "discord", "review", "complete"]);
const MAX_ACCOUNT_FIELD = 200;
const PROVIDERS = new Set(["plex", "jellyfin", "navidrome", "emby"]);
const IDLE_BEHAVIORS = new Set(["clear", "grace", "show", "recent"]);
// Matches MAX_SERVERS in setup-config.js: the account being signed in plus up
// to seven already added (#252).
export const MAX_SETUP_SERVERS = 8;

export function createSetupDraft(input = {}) {
  const step = input.step ?? "welcome";
  if (!STEPS.includes(step)) throw new TypeError("setup.step is invalid");
  if (input.provider !== undefined && input.provider !== null && !PROVIDERS.has(input.provider)) throw new TypeError("setup.provider is invalid");
  if (input.discordEnabled !== undefined && typeof input.discordEnabled !== "boolean") throw new TypeError("setup.discordEnabled is invalid");
  if (input.discordIdleBehavior !== undefined && !IDLE_BEHAVIORS.has(input.discordIdleBehavior)) throw new TypeError("setup.discordIdleBehavior is invalid");
  if (input.discordArtworkLookup !== undefined && typeof input.discordArtworkLookup !== "boolean") throw new TypeError("setup.discordArtworkLookup is invalid");
  if (input.startWithWindows !== undefined && input.startWithWindows !== null && typeof input.startWithWindows !== "boolean") throw new TypeError("setup.startWithWindows is invalid");
  if (input.credential !== undefined || input.token !== undefined || input.apiKey !== undefined) throw new TypeError("setup draft cannot contain credentials");
  const provider = input.provider ?? null;
  const account = createAccount(input.account);
  const servers = createServerList(input.servers);
  return Object.freeze({
    version: 1,
    step,
    provider,
    // Who signed in, never the secret (that lives in the credential store).
    // Choosing a different server drops it, so the account always matches.
    account: account && account.provider === provider ? account : null,
    // Servers already signed in with "Add another server" (#252), oldest
    // first. Accounts only; their secrets are in the credential store.
    servers,
    discordEnabled: input.discordEnabled ?? true,
    discordIdleBehavior: input.discordIdleBehavior ?? "clear",
    // Album art lookup (title + artist to MusicBrainz / Cover Art Archive).
    // On for new setups so Discord shows real covers; the user can turn it off.
    discordArtworkLookup: input.discordArtworkLookup ?? true,
    // null means "not offered / leave as it is" (no Windows startup support).
    startWithWindows: input.startWithWindows ?? null,
  });
}

function createServerList(input) {
  if (input === undefined || input === null) return Object.freeze([]);
  if (!Array.isArray(input) || input.length > MAX_SETUP_SERVERS - 1) throw new TypeError("setup.servers is invalid");
  const seen = new Set();
  return Object.freeze(input.map((item) => {
    let account;
    try { account = createAccount(item); } catch { account = null; }
    if (!account) throw new TypeError("setup.servers is invalid");
    const key = `${account.provider}\u0000${account.id}`;
    if (seen.has(key)) throw new TypeError("setup.servers is invalid");
    seen.add(key);
    return account;
  }));
}

// Every signed-in account setup will save, oldest first. The first one is the
// server the app uses until it can watch several (#252).
export function setupAccounts(draft) {
  const current = createSetupDraft(draft);
  const all = [...current.servers];
  if (current.account && !all.some((item) => item.provider === current.account.provider && item.id === current.account.id)) all.push(current.account);
  return Object.freeze(all);
}

// Keeps the signed-in account and goes back to the server choice so another
// one can be signed in.
export function addAnotherServer(draft) {
  const current = createSetupDraft(draft);
  if (!current.account) throw new SetupStepError("signin_required");
  const servers = setupAccounts(current);
  if (servers.length >= MAX_SETUP_SERVERS) throw new SetupStepError("too_many_servers");
  return createSetupDraft({ ...current, step: "provider", provider: null, account: null, servers });
}

// Drops an added server (never the one being signed in right now).
export function removeSetupServer(draft, { provider, id } = {}) {
  const current = createSetupDraft(draft);
  const servers = current.servers.filter((item) => !(item.provider === provider && item.id === id));
  if (servers.length === current.servers.length) throw new SetupStepError("server_not_found");
  return createSetupDraft({ ...current, servers });
}

function createAccount(input) {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("setup.account is invalid");
  const keys = Object.keys(input);
  if (keys.some((key) => !["provider", "id", "displayName", "serverUrl"].includes(key)) || !PROVIDERS.has(input.provider)) throw new TypeError("setup.account is invalid");
  if (!accountText(input.id) || !accountText(input.displayName)) throw new TypeError("setup.account is invalid");
  if (input.serverUrl !== undefined && !isServerUrl(input.serverUrl)) throw new TypeError("setup.account is invalid");
  return Object.freeze({ provider: input.provider, id: input.id, displayName: input.displayName, ...(input.serverUrl ? { serverUrl: input.serverUrl } : {}) });
}

// The media server address the app will talk to. Not a secret, but it must be a
// plain http(s) origin/path with no embedded credentials.
export function isServerUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
}

function accountText(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ACCOUNT_FIELD;
}

export class SetupStepError extends Error {
  constructor(code) {
    super(code);
    this.name = "SetupStepError";
    this.code = code;
  }
}

// `signIn: false` skips the sign-in step (no credential store to save into).
export function advanceSetupDraft(draft, changes = {}, { signIn = true } = {}) {
  const current = createSetupDraft({ ...draft, ...changes });
  if (current.step === "signin" && !current.account) throw new SetupStepError("signin_required");
  let index = Math.min(STEPS.indexOf(current.step) + 1, STEPS.length - 1);
  if (STEPS[index] === "signin" && !signIn) index += 1;
  return createSetupDraft({ ...current, step: STEPS[index] });
}

export function previousSetupDraft(draft, { signIn = true } = {}) {
  const current = createSetupDraft(draft);
  let index = Math.max(STEPS.indexOf(current.step) - 1, 0);
  if (STEPS[index] === "signin" && !signIn) index -= 1;
  return createSetupDraft({ ...current, step: STEPS[index] });
}

export function serializeSetupDraft(draft) {
  return JSON.stringify(createSetupDraft(draft));
}
