// The NowPlaying Discord application. The ID is public (Discord shows the app
// name on profiles) and ships in the build. NOWPLAYING_DISCORD_CLIENT_ID can
// point a test build at a different app.
export const NOWPLAYING_DISCORD_CLIENT_ID = "1552301957299839116";

const APP_ID = /^\d{17,20}$/;

export function resolveDiscordClientId({ env = process.env, builtIn = NOWPLAYING_DISCORD_CLIENT_ID } = {}) {
  const override = env?.NOWPLAYING_DISCORD_CLIENT_ID;
  if (typeof override === "string" && override.trim()) {
    if (!APP_ID.test(override.trim())) throw new TypeError("NOWPLAYING_DISCORD_CLIENT_ID is not a Discord application ID");
    return override.trim();
  }
  return APP_ID.test(builtIn) ? builtIn : null;
}
