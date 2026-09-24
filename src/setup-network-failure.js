// Sorts a failed request to a media server into something setup can explain
// (#141): the name didn't resolve, the certificate isn't trusted, the server
// was too slow, or it just couldn't be reached. Setup never offers to turn
// certificate checks off; it says what's wrong and how to fix it.
const NAME_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NONAME"]);
const TLS_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "CERT_UNTRUSTED", "CERT_REVOKED",
  "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_SSL_WRONG_VERSION_NUMBER",
]);
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"]);

export function networkFailure(error) {
  for (let item = error, depth = 0; item && depth < 5; item = item.cause, depth += 1) {
    if (item.name === "TimeoutError" || TIMEOUT_CODES.has(item.code)) return "timed_out";
    if (NAME_CODES.has(item.code)) return "name_not_found";
    if (TLS_CODES.has(item.code)) return "tls_untrusted";
  }
  return "unreachable";
}

// Statuses that mean "never got an answer", as opposed to a bad answer.
export const NETWORK_FAILURES = Object.freeze(["unreachable", "name_not_found", "tls_untrusted", "timed_out"]);
