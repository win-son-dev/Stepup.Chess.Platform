import { StepCostPreset } from '../types';
import { CONFIG_KEYS } from '../config/config.service';

/** Maps preset name → Remote Config key. */
const PRESET_CONFIG_KEYS: Record<string, string> = {
  Quick:    CONFIG_KEYS.PRESET_QUICK,
  Normal:   CONFIG_KEYS.PRESET_NORMAL,
  Marathon: CONFIG_KEYS.PRESET_MARATHON,
};

/** Valid preset names — use for validation before fetching config. */
export const KNOWN_PRESET_NAMES = Object.keys(PRESET_CONFIG_KEYS);

/**
 * Reads a preset's move costs from Remote Config.
 *
 * The config value is a JSON object (string) stored under the preset's key.
 * Falls back to the embedded defaults if parsing fails — this should never
 * happen in practice because DEFAULT_CONFIG in config.service.ts always
 * provides a valid JSON string.
 *
 * @param config  — result of getConfigAsync()
 * @param name    — preset name (e.g. 'Quick', 'Normal', 'Marathon')
 */
export function getPreset(
  config: { getString: (key: string) => string },
  name: string,
): StepCostPreset {
  const configKey = PRESET_CONFIG_KEYS[name];
  if (!configKey) throw new Error(`Unknown preset: ${name}`);

  const raw = config.getString(configKey);
  const values = JSON.parse(raw) as Omit<StepCostPreset, 'name'>;
  return { name, ...values };
}
