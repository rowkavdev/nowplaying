const SUBSYSTEMS = new Set(["configuration", "provider", "discord", "updater", "unknown"]);
const FAILURE_THRESHOLD = 3;

export function createStartupRecoveryState(input = {}) {
  const failures = Number.isInteger(input.failures) && input.failures >= 0 ? input.failures : 0;
  const subsystem = SUBSYSTEMS.has(input.subsystem) ? input.subsystem : null;
  const safeMode = failures >= FAILURE_THRESHOLD;
  return Object.freeze({
    version: 1,
    failures,
    subsystem,
    safeMode,
    capabilities: Object.freeze({ polling: !safeMode, discord: !safeMode, updates: !safeMode, settings: true, diagnostics: true, retry: true }),
  });
}

/** Record a failure that happened before startup was confirmed healthy. */
export function recordStartupFailure(state, subsystem = "unknown") {
  if (!SUBSYSTEMS.has(subsystem)) throw new TypeError("startup recovery subsystem is invalid");
  const current = createStartupRecoveryState(state);
  return createStartupRecoveryState({ failures: current.failures + 1, subsystem });
}

/** Clear crash-loop state only after the caller confirms a healthy start. */
export function confirmHealthyStartup(state, healthy) {
  if (healthy !== true) return createStartupRecoveryState(state);
  return createStartupRecoveryState();
}

export function startupRecoveryActions(state) {
  const current = createStartupRecoveryState(state);
  return Object.freeze(current.safeMode ? ["open_settings", "export_diagnostics", "retry_normal_startup"] : []);
}

export { FAILURE_THRESHOLD as startupFailureThreshold };
