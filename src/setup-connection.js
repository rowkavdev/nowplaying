import { networkFailure } from "./setup-network-failure.js";
const AUTHENTICATION_STATUS = /request failed:\s*(401|403)\b/i;

export async function checkProviderConnection({ createProvider, config, context = {} }) {
  if (typeof createProvider !== "function") throw new TypeError("createProvider must be a function");

  let provider;
  try {
    provider = createProvider(config);
  } catch {
    return connectionResult("invalid_configuration");
  }

  try {
    const presence = await provider.getPresence(context);
    const user = await checkUser(provider, config?.identity);
    if (user !== "ok") return connectionResult(user);
    return connectionResult("connected", presence?.state ?? "idle");
  } catch (error) {
    if (AUTHENTICATION_STATUS.test(String(error?.message))) {
      return connectionResult("authentication_failed");
    }
    if (isNetworkError(error)) return connectionResult(networkFailure(error));
    return connectionResult("connection_failed");
  }
}

// When the provider can say who the saved sign-in belongs to, make sure it's
// the account setup signed in as. Otherwise the app would filter for a user
// the server never reports and the card would stay "not playing" forever.
async function checkUser(provider, identity) {
  if (typeof provider.whoami !== "function" || !identity?.id) return "ok";
  let user;
  try {
    user = await provider.whoami();
  } catch (error) {
    // A rejected sign-in is a real failure; anything else just means this
    // server can't answer the question, which isn't the user's problem.
    if (AUTHENTICATION_STATUS.test(String(error?.message))) throw error;
    return "ok";
  }
  if (!user?.id && !user?.displayName) return "ok";
  if (user.id && user.id === identity.id) return "ok";
  if (!user.id && sameName(user.displayName, identity.displayName)) return "ok";
  return "user_mismatch";
}

function sameName(a, b) {
  return typeof a === "string" && typeof b === "string" && a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

function connectionResult(status, activity = null) {
  return Object.freeze({ ok: status === "connected", status, activity });
}

function isNetworkError(error) {
  if (error instanceof TypeError || error?.name === "TimeoutError") return true;
  return ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(error?.cause?.code ?? error?.code);
}
