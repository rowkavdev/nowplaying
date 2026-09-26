const MAX_VARIANTS = 32;
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN"]);

export function createResilientCardResolver({ resolveCard, timeoutMs = 5000, staleMs = 300000, diagnostics = false, now = () => performance.now() } = {}) {
  if (typeof resolveCard !== "function") throw new TypeError("resolveCard: expected a function");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new RangeError("timeoutMs must be an integer from 1 to 30000");
  if (!Number.isInteger(staleMs) || staleMs < 0 || staleMs > 3600000) throw new RangeError("staleMs must be an integer from 0 to 3600000");
  if (typeof diagnostics !== "boolean") throw new TypeError("diagnostics: expected a boolean");
  if (typeof now !== "function") throw new TypeError("now: expected a function");
  // Cache age measures elapsed process time, not the adjustable wall clock.
  const inFlight = new Map();
  const lastGood = new Map();
  let generation = 0;

  function remember(key, value) {
    lastGood.delete(key);
    lastGood.set(key, value);
    while (lastGood.size > MAX_VARIANTS) lastGood.delete(lastGood.keys().next().value);
  }

  function output(svg, fields) {
    return diagnostics ? Object.freeze({ svg, ...fields }) : svg;
  }

  async function resilientResolve(options = {}) {
    const epoch = generation;
    const key = variantKey(options);
    let pending = inFlight.get(key);
    if (!pending) {
      pending = withTimeout(Promise.resolve().then(() => resolveCard(options)), timeoutMs)
        .then((result) => {
          const svg = typeof result === "string" ? result : result?.svg;
          const source = result?.source === "idle" ? "idle" : "live";
          if (epoch === generation) remember(key, { svg, source, at: now() });
          return { svg, source };
        })
        .finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); });
      inFlight.set(key, pending);
    }
    try {
      const { svg, source } = await pending;
      if (epoch !== generation) return resilientResolve(options);
      return output(svg, { source, ageMs: 0, cache: "miss", provider: "ok" });
    } catch (error) {
      if (epoch !== generation) return resilientResolve(options);
      const good = lastGood.get(key);
      const ageMs = good ? Math.max(0, now() - good.at) : Infinity;
      if (good && ageMs <= staleMs) return output(good.svg, { source: "last-good", ageMs, cache: "hit", provider: classifyFailure(error) });
      throw error;
    }
  }
  resilientResolve.invalidate = () => {
    generation += 1;
    lastGood.clear();
    inFlight.clear();
  };
  return resilientResolve;
}

export function classifyFailure(error) {
  if (error?.name === "CardTimeoutError") return "timeout";
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  if (status === 401 || status === 403) return "unauthorized";
  const code = String(error?.code ?? error?.cause?.code ?? "");
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return "timeout";
  if (UNREACHABLE_CODES.has(code)) return "unreachable";
  return "error";
}

function variantKey(options) {
  if (!options || typeof options !== "object") return "{}";
  return JSON.stringify(Object.keys(options).sort().map((name) => [name, options[name]]));
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("card resolution timed out");
      error.name = "CardTimeoutError";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
