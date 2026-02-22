import { getRemoteConfig } from 'firebase-admin/remote-config';
import { defineSecret } from 'firebase-functions/params';

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

  // Step-cost presets — JSON objects with piece costs per preset.
  // Override these in the Firebase console to tune game balance without a deploy.
  PRESET_QUICK: 'preset_quick',
  PRESET_NORMAL: 'preset_normal',
  PRESET_MARATHON: 'preset_marathon',
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
  [CONFIG_KEYS.PRESET_QUICK]:    '{"pawn":2,"knight":5,"bishop":5,"rook":7,"queen":10,"king":3,"distanceCost":1}',
  [CONFIG_KEYS.PRESET_NORMAL]:   '{"pawn":50,"knight":80,"bishop":80,"rook":100,"queen":150,"king":30,"distanceCost":10}',
  [CONFIG_KEYS.PRESET_MARATHON]: '{"pawn":200,"knight":350,"bishop":350,"rook":500,"queen":750,"king":100,"distanceCost":50}',
};

// === REMOTE CONFIG HELPER ===
// Cached per function instance — re-fetched on cold start only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let configCache: any = null;

/** Fallback used when the RC template hasn't been published yet (e.g. emulator). */
function makeFallbackConfig() {
  return {
    getNumber:  (key: string) => (DEFAULT_CONFIG[key] as number)  ?? 0,
    getBoolean: (key: string) => (DEFAULT_CONFIG[key] as boolean) ?? false,
    getString:  (key: string) => String(DEFAULT_CONFIG[key]       ?? ''),
  };
}

export async function getConfigAsync() {
  if (!configCache) {
    try {
      const rc = getRemoteConfig();
      const template = rc.initServerTemplate({ defaultConfig: DEFAULT_CONFIG });
      await template.load();
      configCache = template.evaluate();
    } catch {
      // Remote Config template not published yet (emulator or first deploy).
      // Fall back to hardcoded defaults so functions still work locally.
      configCache = makeFallbackConfig();
    }
  }
  return configCache;
}
