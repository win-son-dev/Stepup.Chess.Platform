import { StepCostPreset, CostMode, PieceType } from './types';

/**
 * Mirrors the cost calculator logic from lib/engine/cost_calculator.dart.
 *
 * Three cost modes:
 *   baseDistance — base cost per piece + distance * distanceCost
 *   distance     — distance * distanceCost only (no base)
 *   fixed        — flat base cost per piece; king captures cost double
 *
 * Distance metric:
 *   Knights  → Manhattan distance (|dx| + |dy|, always 3 for a valid L-move)
 *   All else → Chebyshev distance (max(|dx|, |dy|))
 */

function baseCostFor(preset: StepCostPreset, piece: PieceType): number {
  switch (piece) {
    case 'p': return preset.pawn;
    case 'n': return preset.knight;
    case 'b': return preset.bishop;
    case 'r': return preset.rook;
    case 'q': return preset.queen;
    case 'k': return preset.king;
  }
}

function moveDistance(piece: PieceType, from: string, to: string): number {
  const dx = Math.abs(to.charCodeAt(0) - from.charCodeAt(0));
  const dy = Math.abs(to.charCodeAt(1) - from.charCodeAt(1));
  if (piece === 'n') return dx + dy; // Manhattan — always 3 for a legal knight move
  return Math.max(dx, dy);           // Chebyshev
}

export function calculateCost(
  preset: StepCostPreset,
  costMode: CostMode,
  piece: PieceType,
  from: string,
  to: string,
  capturingKing = false,
): number {
  switch (costMode) {
    case 'baseDistance': {
      const base = baseCostFor(preset, piece);
      return base + moveDistance(piece, from, to) * preset.distanceCost;
    }
    case 'distance':
      return moveDistance(piece, from, to) * preset.distanceCost;
    case 'fixed': {
      const base = baseCostFor(preset, piece);
      return capturingKing ? base * 2 : base;
    }
  }
}
