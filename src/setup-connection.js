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
    return connectionResult("connected", presence?.state ?? "idle");
  } catch (error) {
    if (AUTHENTICATION_STATUS.test(String(error?.message))) {
      return connectionResult("authentication_failed");
    }
    if (isNetworkError(error)) return connectionResult("unreachable");
    return connectionResult("connection_failed");
  }
}

function connectionResult(status, activity = null) {
  return Object.freeze({ ok: status === "connected", status, activity });
}

function isNetworkError(error) {
  if (error instanceof TypeError) return true;
  return ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(error?.cause?.code ?? error?.code);
}
