import { StepCostPreset } from './types';

/**
 * Mirrors the preset definitions in lib/config/constants.dart exactly.
 * Keys must match the presetName strings stored in OnlineGame.
 */
export const PRESETS: Record<string, StepCostPreset> = {
  Quick: {
    name: 'Quick',
    pawn: 2,
    knight: 5,
    bishop: 5,
    rook: 7,
    queen: 10,
    king: 3,
    distanceCost: 1,
  },
  Normal: {
    name: 'Normal',
    pawn: 50,
    knight: 80,
    bishop: 80,
    rook: 100,
    queen: 150,
    king: 30,
    distanceCost: 10,
  },
  Marathon: {
    name: 'Marathon',
    pawn: 200,
    knight: 350,
    bishop: 350,
    rook: 500,
    queen: 750,
    king: 100,
    distanceCost: 50,
  },
};

export function getPreset(name: string): StepCostPreset {
  const preset = PRESETS[name];
  if (!preset) throw new Error(`Unknown preset: ${name}`);
  return preset;
}
