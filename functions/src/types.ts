export type OnlineGameStatus = 'waiting' | 'active' | 'completed' | 'abandoned';

export type GameOutcome = 'win' | 'draw' | 'abandoned';

export type OnlineGame = {
  id: string;
  whitePlayerId: string;
  blackPlayerId: string | null;
  fen: string;
  moveHistory: string[];
  status: OnlineGameStatus;
  presetName: string;
  costModeName: string;
  createdAt: string; // ISO 8601
  outcome?: GameOutcome;  // set when game ends
  winnerId?: string;      // set when outcome === 'win'
};

// Mirrors Dart CostMode enum
export type CostMode = 'baseDistance' | 'distance' | 'fixed';

export type StepCostPreset = {
  name: string;
  pawn: number;
  knight: number;
  bishop: number;
  rook: number;
  queen: number;
  king: number;
  distanceCost: number;
};

// chess.js internal piece type character
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
