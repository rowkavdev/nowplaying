import sharp from "sharp";
import { createSharpArtworkSanitizer } from "./artwork-sanitizer.js";

export function createDefaultArtworkSanitizer(options = {}) {
  return createSharpArtworkSanitizer({ sharpFactory: sharp, ...options });
}
