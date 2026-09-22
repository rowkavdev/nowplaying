const STEPS = Object.freeze(["welcome", "provider", "discord", "review", "complete"]);
const PROVIDERS = new Set(["plex", "jellyfin", "navidrome", "emby"]);

export function createSetupDraft(input = {}) {
  const step = input.step ?? "welcome";
  if (!STEPS.includes(step)) throw new TypeError("setup.step is invalid");
  if (input.provider !== undefined && !PROVIDERS.has(input.provider)) throw new TypeError("setup.provider is invalid");
  if (input.credential !== undefined || input.token !== undefined || input.apiKey !== undefined) throw new TypeError("setup draft cannot contain credentials");
  return Object.freeze({
    version: 1,
    step,
    provider: input.provider ?? null,
    discordEnabled: input.discordEnabled ?? true,
    discordIdleBehavior: input.discordIdleBehavior ?? "clear",
  });
}

export function advanceSetupDraft(draft, changes = {}) {
  const current = createSetupDraft({ ...draft, ...changes });
  const index = STEPS.indexOf(current.step);
  return createSetupDraft({ ...current, step: STEPS[Math.min(index + 1, STEPS.length - 1)] });
}

export function serializeSetupDraft(draft) {
  return JSON.stringify(createSetupDraft(draft));
}
