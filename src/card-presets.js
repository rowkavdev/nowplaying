// Shared by the renderer, validation and Settings. A style includes type and
// spacing, not just a palette. Explicit layout options always take precedence.
const preset = (label, description, layout = {}, show = {}) => Object.freeze({ label, description, layout: Object.freeze(layout), show: Object.freeze(show) });
export const cardPresets = Object.freeze({
  "midnight-blue": preset("Classic", "Dark background, blue accent."),
  paper: preset("Paper", "A crisp white card."),
  compact: preset("Compact", "A single line, without a cover.", {}, { artwork: false, progress: false, state: false, subtitle: false, time: false }),
  studio: preset("Studio", "Smaller cover, warm accent.", { padding: 20, radius: 12, titleSize: 18, subtitleSize: 13, artworkWidth: 80, artworkHeight: 80, artShape: "rounded", statusStyle: "dot", progressStyle: "rounded", progressHeight: 2 }),
  editorial: preset("Editorial", "Warm paper and serif type.", { padding: 24, radius: 0, fontFamily: "serif", titleSize: 24, subtitleSize: 14, statusStyle: "caps", progressHeight: 2, artworkPosition: "right" }),
  terminal: preset("Terminal", "Monospace. Square edges.", { padding: 20, radius: 0, fontFamily: "mono", titleSize: 18, subtitleSize: 12, statusStyle: "caps", progressHeight: 2, artworkWidth: 80, artworkHeight: 80 }),
});
