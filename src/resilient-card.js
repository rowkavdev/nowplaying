export function createResilientCardResolver({ resolveCard, timeoutMs = 5000, staleMs = 300000 } = {}) {
  if (typeof resolveCard !== "function") throw new TypeError("resolveCard: expected a function");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new RangeError("timeoutMs must be an integer from 1 to 30000");
  if (!Number.isInteger(staleMs) || staleMs < 0 || staleMs > 3600000) throw new RangeError("staleMs must be an integer from 0 to 3600000");
  let inFlight;
  let lastGood;

  return async function resilientResolve(options = {}) {
    if (!inFlight) {
      inFlight = withTimeout(Promise.resolve().then(() => resolveCard(options)), timeoutMs)
        .then((svg) => { lastGood = { svg, at: Date.now() }; return svg; })
        .finally(() => { inFlight = undefined; });
    }
    try { return await inFlight; }
    catch (error) {
      if (lastGood && Date.now() - lastGood.at <= staleMs) return lastGood.svg;
      throw error;
    }
  };
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("card resolution timed out")), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
