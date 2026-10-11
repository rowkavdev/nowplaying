import { handlers } from "../lib/default.js";

export default function handler(req, res) {
  return handlers.pcsBadge(req, res);
}
