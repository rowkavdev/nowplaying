// Shared by the renderer, validation and Settings. A style includes type and
// spacing, not just a palette. Explicit layout options always take precedence.
const preset = (label, description, layout = {}, show = {}) => Object.freeze({ label, description, layout: Object.freeze(layout), show: Object.freeze(show) });
export const cardPresets = Object.freeze({
  "midnight-blue": preset("Classic", "Dark background, blue accent."),
  paper: preset("Paper", "A crisp white card."),
  compact: preset("Compact", "A single line, without a cover.", {}, { artwork: false, progress: false, state: false, subtitle: false, time: false }),
  studio: preset("Studio", "Cinema lighting, full-bleed art and a framed cover.", { padding: 24, radius: 20, titleSize: 22, subtitleSize: 13, artworkWidth: 112, artworkHeight: 148, artworkPosition: "right", artShape: "rounded", statusStyle: "dot", progressStyle: "rounded", progressHeight: 2 }),
  editorial: preset("Editorial", "A printed sleeve: large art, serif type and a ticket seam.", { padding: 24, radius: 0, fontFamily: "serif", titleSize: 24, subtitleSize: 14, statusStyle: "caps", progressHeight: 2, artworkWidth: 120, artworkHeight: 164, artworkPosition: "left" }),
  terminal: preset("Hi-Fi", "A record deck, amber display and segmented timeline.", { padding: 24, radius: 16, fontFamily: "mono", titleSize: 18, subtitleSize: 12, statusStyle: "caps", progressHeight: 4, artworkWidth: 112, artworkHeight: 112, artShape: "circle" }),
});
