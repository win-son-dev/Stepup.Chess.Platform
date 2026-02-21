export type OnlineGameStatus = 'waiting' | 'active' | 'completed' | 'abandoned';

export interface OnlineGame {
  id: string;
  whitePlayerId: string;
  blackPlayerId: string | null;
  fen: string;
  moveHistory: string[];
  status: OnlineGameStatus;
  presetName: string;
  costModeName: string;
  createdAt: string; // ISO 8601
}

export type StepTransactionSource = 'pedometer' | 'move' | 'king_capture' | 'debug';

export interface StepTransactionData {
  amount: number;       // positive = earn, negative = spend
  balanceAfter: number;
  source: StepTransactionSource;
  timestamp: string;    // ISO 8601
  gameId?: string;
  piece?: string;       // uppercase piece char e.g. "N"
  moveFrom?: string;    // e.g. "e2"
  moveTo?: string;      // e.g. "e4"
}

// Mirrors Dart CostMode enum
export type CostMode = 'baseDistance' | 'distance' | 'fixed';

export interface StepCostPreset {
  name: string;
  pawn: number;
  knight: number;
  bishop: number;
  rook: number;
  queen: number;
  king: number;
  distanceCost: number;
}

// chess.js internal piece type character
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
