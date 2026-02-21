import { defineSecret } from 'firebase-functions/params';
import { getRemoteConfig } from 'firebase-admin/remote-config';

// === SECRETS ===
// Add secrets here as integrations are added (e.g. push notification keys, webhook secrets).
// Access them inside a function via secret.value() — only available at runtime, not build time.
export const SECRET_KEYS = {
  WEB_API_KEY: 'WEB_API_KEY',
} as const;

export const webApiKey = defineSecret(SECRET_KEYS.WEB_API_KEY);

// === REMOTE CONFIG KEYS ===
export const CONFIG_KEYS = {
  // Anti-cheat: cap on steps that can be submitted in a single call
  MAX_STEP_DELTA_PER_CALL: 'max_step_delta_per_call',

  // Anti-cheat: max steps a user can earn per hour across all calls
  MAX_STEPS_PER_HOUR: 'max_steps_per_hour',

  // Feature flags
  ENABLE_MATCHMAKING: 'enable_matchmaking',
  ENABLE_LEADERBOARD: 'enable_leaderboard',
  ENABLE_CHAT: 'enable_chat',

  // Game limits
  MAX_MOVE_HISTORY_LENGTH: 'max_move_history_length',
} as const;

// === REMOTE CONFIG DEFAULTS ===
// These are used when Remote Config template hasn't been fetched yet (cold start).
const DEFAULT_CONFIG: Record<string, string | number | boolean> = {
  [CONFIG_KEYS.MAX_STEP_DELTA_PER_CALL]: 10000,
  [CONFIG_KEYS.MAX_STEPS_PER_HOUR]: 50000,
  [CONFIG_KEYS.ENABLE_MATCHMAKING]: true,
  [CONFIG_KEYS.ENABLE_LEADERBOARD]: true,
  [CONFIG_KEYS.ENABLE_CHAT]: true,
  [CONFIG_KEYS.MAX_MOVE_HISTORY_LENGTH]: 500,
};

// === REMOTE CONFIG HELPER ===
// Cached per function instance — re-fetched on cold start only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let configCache: any = null;

export async function getConfigAsync() {
  if (!configCache) {
    const rc = getRemoteConfig();
    const template = rc.initServerTemplate({ defaultConfig: DEFAULT_CONFIG });
    await template.load();
    configCache = template.evaluate();
  }
  return configCache;
}
