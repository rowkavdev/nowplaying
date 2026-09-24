import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { buildAuthorizeUrl, createPkcePair, exchangeCode, readCallback } from "./spotify-auth.js";

// Runs one Spotify sign-in (#135): listens on 127.0.0.1 on a free port,
// opens Spotify's consent page, waits for the redirect, swaps the code for
// tokens and closes. Spotify allows a loopback redirect registered without a
// port, so users register http://127.0.0.1/spotify/callback once and any port
// works. Nothing listens beyond this one sign-in, and only on loopback.

const CALLBACK_PATH = "/spotify/callback";

function page(title, text) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>`
    + `<body style="font-family:system-ui,sans-serif;margin:3rem;color:#1f2937"><h1 style="font-size:1.25rem">${title}</h1><p>${text}</p></body></html>`;
}

export function signInToSpotify({ clientId, openUrl, fetchImpl = fetch, timeoutMs = 300_000, host = "127.0.0.1" } = {}) {
  if (typeof openUrl !== "function") throw new TypeError("openUrl is required");
  const { verifier, challenge } = createPkcePair();
  const state = randomBytes(18).toString("base64url");

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const server = createServer((request, response) => {
      const url = new URL(request.url, `http://${host}`);
      if (request.method !== "GET" || url.pathname !== CALLBACK_PATH) {
        response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      let code;
      try {
        code = readCallback(url.toString(), state);
      } catch (error) {
        // A stray request with the wrong state doesn't end the sign-in.
        if (error.code === "state_mismatch") {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(page("Sign-in not recognised", "This page wasn't opened by NowPlaying. You can close it."));
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page("Spotify not connected", "Spotify sign-in was cancelled. You can close this tab."));
        finish(error);
        return;
      }
      const redirectUri = `http://${host}:${server.address().port}${CALLBACK_PATH}`;
      exchangeCode({ clientId, code, redirectUri, verifier, fetchImpl }).then((tokens) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page("Spotify connected", "You can close this tab and go back to NowPlaying."));
        finish(null, tokens);
      }, (error) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page("Spotify not connected", "Something went wrong. Go back to NowPlaying and try again."));
        finish(error);
      });
    });

    function finish(error, tokens) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
      if (error) reject(error); else resolve(tokens);
    }

    server.on("error", (error) => finish(error));
    server.listen(0, host, async () => {
      const redirectUri = `http://${host}:${server.address().port}${CALLBACK_PATH}`;
      timer = setTimeout(() => finish(Object.assign(new Error("Spotify sign-in timed out"), { code: "timeout" })), timeoutMs);
      timer.unref?.();
      try {
        await openUrl(buildAuthorizeUrl({ clientId, redirectUri, state, challenge }));
      } catch (error) {
        finish(error);
      }
    });
  });
}
