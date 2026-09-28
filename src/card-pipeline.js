import { applyPrivacy } from "./privacy.js";
import { renderCard } from "./card.js";

export function createCardPipeline({ provider, privacy = {}, artworkService, providerConfig, renderer = renderCard, defaults } = {}) {
  if (!provider || typeof provider.getPresence !== "function") throw new TypeError("provider: expected a provider");
  if (artworkService !== undefined && (!artworkService || typeof artworkService.resolve !== "function")) throw new TypeError("artworkService: expected an artwork service");
  if (typeof renderer !== "function") throw new TypeError("renderer: expected a function");
  if (defaults !== undefined && typeof defaults !== "function") throw new TypeError("defaults: expected a function");

  return async function resolveCard(options = {}) {
    const rawPresence = await provider.getPresence();
    const presence = applyPrivacy(rawPresence, privacy);
    // Saved appearance comes first; query options replace it. Match the
    // renderer's compact default before fetching artwork that cannot be shown.
    const { artworkTint = true, ...base } = defaults ? defaults() : {};
    const theme = options.theme ?? base.theme ?? "midnight-blue";
    const show = options.show ?? base.show ?? {};
    const showArtwork = show.artwork ?? theme !== "compact";
    const art = showArtwork && presence.artwork && artworkService
      ? await artworkService.resolve(presence.artwork, providerConfig)
      : null;
    // A service can return the data URI alone, or with a tint taken from the
    // art (#447).
    const artworkDataUri = typeof art === "string" ? art : art?.dataUri ?? null;
    const tint = artworkTint && artworkDataUri && typeof art?.tint === "string" ? { tint: art.tint } : {};
    return renderer(presence, { ...base, ...options, artworkDataUri, ...tint });
  };
}
