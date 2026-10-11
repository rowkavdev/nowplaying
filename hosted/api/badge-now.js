import { handlers } from "../lib/default.js";

export default function handler(req, res) {
  return handlers.nowBadge(req, res);
}
