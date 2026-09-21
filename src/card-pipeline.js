import { applyPrivacy } from "./privacy.js";
import { renderCard } from "./card.js";

export function createCardPipeline({ provider, privacy = {}, artworkService, providerConfig, renderer = renderCard } = {}) {
  if (!provider || typeof provider.getPresence !== "function") throw new TypeError("provider: expected a provider");
  if (artworkService !== undefined && (!artworkService || typeof artworkService.resolve !== "function")) throw new TypeError("artworkService: expected an artwork service");
  if (typeof renderer !== "function") throw new TypeError("renderer: expected a function");

  return async function resolveCard(options = {}) {
    const rawPresence = await provider.getPresence();
    const presence = applyPrivacy(rawPresence, privacy);
    const artworkDataUri = presence.artwork && artworkService
      ? await artworkService.resolve(presence.artwork, providerConfig)
      : null;
    return renderer(presence, { ...options, artworkDataUri });
  };
}
