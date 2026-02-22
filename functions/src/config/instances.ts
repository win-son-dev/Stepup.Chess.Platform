import { webApiKey } from './config.service';

/**
 * Per-function instance configuration.
 * All callable functions enforce App Check to block non-app clients.
 * App Check is disabled in the emulator — the emulator does not issue
 * App Check tokens, so enforcing it would reject every call.
 * The RTDB trigger (matchmaking) cannot use App Check — it's server-side.
 */
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

/**
 * submitStepDelta — called frequently (every pedometer batch).
 * Higher maxInstances to handle many concurrent walkers.
 */
export const submitStepDeltaConfig = {
  maxInstances: 10,
  timeoutSeconds: 30,
  memory: '256MiB' as const,
  enforceAppCheck: !isEmulator,
};

/**
 * createGame — called once per game session start.
 */
export const createGameConfig = {
  maxInstances: 5,
  timeoutSeconds: 30,
  memory: '256MiB' as const,
  enforceAppCheck: !isEmulator,
};

/**
 * joinGame — called once when a second player joins.
 */
export const joinGameConfig = {
  maxInstances: 5,
  timeoutSeconds: 30,
  memory: '256MiB' as const,
  enforceAppCheck: !isEmulator,
};

/**
 * makeMove — the hottest function; called on every chess move.
 * Highest maxInstances to handle concurrent active games.
 */
export const makeMoveConfig = {
  maxInstances: 20,
  timeoutSeconds: 30,
  memory: '256MiB' as const,
  enforceAppCheck: !isEmulator,
};

/**
 * endGame — called once per game at conclusion.
 */
export const endGameConfig = {
  maxInstances: 5,
  timeoutSeconds: 30,
  memory: '256MiB' as const,
  enforceAppCheck: !isEmulator,
};

/**
 * matchmakingOnQueueWrite — RTDB trigger, not a callable.
 * App Check does not apply to database triggers.
 */
export const matchmakingConfig = {
  maxInstances: 5,
  timeoutSeconds: 60,
  memory: '256MiB' as const,
  region: 'us-central1' as const,
  // NOTE: change region to 'asia-southeast1' when deploying to production
  // to match the RTDB region. The emulator only supports us-central1.
};

/**
 * onGameCompleted — Firestore trigger, not a callable.
 * Fires on every game document update; only acts on status → 'completed'.
 */
export const leaderboardConfig = {
  maxInstances: 5,
  timeoutSeconds: 30,
  memory: '256MiB' as const,
};

/**
 * Auth-gated functions that need the web API key secret.
 * (Reserved for future server-side auth operations if needed.)
 */
export const authConfig = {
  maxInstances: 5,
  timeoutSeconds: 30,
  memory: '256MiB' as const,
  secrets: [webApiKey],
  enforceAppCheck: true,
};
