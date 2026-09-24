import { handlers } from "../lib/default.js";

export default function handler(req, res) {
  return handlers.devices(req, res);
}
