import { handlers } from "../lib/default.js";

export default function handler(req, res) {
  return handlers.register(req, res);
}
