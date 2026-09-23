const STEPS = Object.freeze(["welcome", "provider", "discord", "review", "complete"]);
const PROVIDERS = new Set(["plex", "jellyfin", "navidrome", "emby"]);
const IDLE_BEHAVIORS = new Set(["clear", "grace", "show", "recent"]);

export function createSetupDraft(input = {}) {
  const step = input.step ?? "welcome";
  if (!STEPS.includes(step)) throw new TypeError("setup.step is invalid");
  if (input.provider !== undefined && input.provider !== null && !PROVIDERS.has(input.provider)) throw new TypeError("setup.provider is invalid");
  if (input.discordEnabled !== undefined && typeof input.discordEnabled !== "boolean") throw new TypeError("setup.discordEnabled is invalid");
  if (input.discordIdleBehavior !== undefined && !IDLE_BEHAVIORS.has(input.discordIdleBehavior)) throw new TypeError("setup.discordIdleBehavior is invalid");
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

export function previousSetupDraft(draft) {
  const current = createSetupDraft(draft);
  const index = STEPS.indexOf(current.step);
  return createSetupDraft({ ...current, step: STEPS[Math.max(index - 1, 0)] });
}

export function serializeSetupDraft(draft) {
  return JSON.stringify(createSetupDraft(draft));
}
