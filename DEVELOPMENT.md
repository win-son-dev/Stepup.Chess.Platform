# Stepup Chess Platform — Development Guide

Backend: Firebase Cloud Functions (Node 20 / TypeScript) + Realtime Database + Firestore.

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Local Development](#local-development)
3. [Cloud Functions API Reference](#cloud-functions-api-reference)
4. [Database Schema](#database-schema)
5. [Step Cost System](#step-cost-system)
6. [Configuration & Feature Flags](#configuration--feature-flags)
7. [Security Model](#security-model)
8. [Adding a New Function](#adding-a-new-function)
9. [Deployment](#deployment)

---

## Project Structure

```
functions/src/
├── index.ts                      # Entry point — re-exports all Cloud Functions
├── types.ts                      # Shared TypeScript types
│
├── config/
│   ├── config.service.ts         # Firebase Remote Config + secrets
│   └── instances.ts              # Per-function scaling / timeout / App Check config
│
├── repositories/                 # Data access layer (all RTDB / Firestore reads & writes)
│   ├── game.repository.ts        # Game CRUD (RTDB + Firestore dual-write)
│   ├── user.repository.ts        # User profile, leaderboard (Firestore)
│   └── step.repository.ts        # Step balances in RTDB under the game node
│
├── services/                     # Business / domain logic (no direct DB calls)
│   ├── game.service.ts           # Chess move validation, cost calculation
│   └── user.service.ts           # Avatar color generation
│
├── functions/                    # Thin Cloud Function handlers (auth → delegate → return)
│   ├── game.functions.ts         # createGame, joinGame, makeMove, endGame
│   ├── matchmaking.functions.ts  # matchmakingOnQueueWrite (RTDB trigger)
│   ├── steps.functions.ts        # submitStepDelta
│   └── user.functions.ts         # onUserCreated, updateDisplayName
│
└── utils/
    ├── constants.ts              # INITIAL_FEN and other shared constants
    ├── presets.ts                # Step cost preset definitions (Quick / Normal / Marathon)
    └── cost-calculator.ts        # Move cost calculation logic
```

**Layer responsibilities:**

| Layer | Owns | Does NOT own |
|---|---|---|
| `functions/` | Auth check, input validation, HTTP response | DB calls, business logic |
| `services/` | Domain rules, chess engine, cost math | DB calls, HTTP |
| `repositories/` | All RTDB / Firestore reads & writes | Business logic |
| `utils/` | Pure functions, constants, preset data | Side effects |

---

## Local Development

### Prerequisites

- Node 20+
- Firebase CLI: `npm install -g firebase-tools`
- Java (required by the Firestore emulator)

### First-time setup

```bash
# Install function dependencies
cd functions && npm install

# Log in and select the project
firebase login
firebase use stepup-chess-dev   # or your project alias
```

### Start the emulator stack

```bash
make start
```

This kills any stale ports, compiles TypeScript, then starts Auth + Functions + Firestore + RTDB emulators with persistent seed data saved to `./emulator-seed/`.

| Emulator | Port |
|---|---|
| Emulator UI | http://localhost:4000 |
| Auth | 9099 |
| Cloud Functions | 5001 |
| Firestore | 8080 |
| Realtime Database | 9000 |

### Other Makefile targets

```bash
make build       # Compile TypeScript only (no emulator start)
make emulators   # Start emulators without rebuilding
make stop        # Kill all emulator processes
```

### Watch mode (auto-recompile on save)

```bash
cd functions && npm run build:watch
```

Then in a second terminal:

```bash
make emulators
```

### Self-join in the emulator

The emulator allows a single test account to create and immediately join its own game (`FUNCTIONS_EMULATOR=true` bypasses the "cannot join your own game" guard in `joinGame`).

---

## Cloud Functions API Reference

All callable functions use **Firebase App Check** (enforced in production; skipped in emulator).
Caller identity always comes from the **Firebase Auth bearer token**, never from the request body.

---

### `createGame`

Creates a new game. The caller becomes white. Game starts in `waiting` status.

**Trigger:** HTTPS Callable
**Auth:** Required

**Request**
```json
{
  "presetName": "Normal",
  "costModeName": "distance"
}
```

| Field | Type | Values |
|---|---|---|
| `presetName` | string | `"Quick"` \| `"Normal"` \| `"Marathon"` |
| `costModeName` | string | `"baseDistance"` \| `"distance"` \| `"fixed"` |

**Response**
```json
{ "gameId": "<string>" }
```

**Side effects**
- Writes game to `RTDB /games/{gameId}` and `Firestore games/{gameId}`
- Sets `RTDB /userActiveGame/{uid}` → `gameId`

**Errors**
| Code | Reason |
|---|---|
| `unauthenticated` | No auth token |
| `invalid-argument` | Missing or unknown presetName / costModeName |
| `failed-precondition` | Caller already has an active game |

---

### `joinGame`

The caller joins a waiting game as black. Sets game status to `active`.

**Trigger:** HTTPS Callable
**Auth:** Required

**Request**
```json
{ "gameId": "<string>" }
```

**Response**
```json
{ "success": true }
```

**Side effects**
- Updates `blackPlayerId` and `status` in RTDB + Firestore
- Sets `RTDB /userActiveGame/{uid}` → `gameId`

**Errors**
| Code | Reason |
|---|---|
| `unauthenticated` | No auth token |
| `invalid-argument` | Missing gameId |
| `not-found` | Game does not exist |
| `failed-precondition` | Game already full, or caller has an active game |
| `failed-precondition` | Attempting to join own game (production only) |

---

### `makeMove`

Authoritative move handler. Validates the move with chess.js, checks and deducts the step cost, updates game state.

**Trigger:** HTTPS Callable
**Auth:** Required

**Request**
```json
{
  "gameId": "<string>",
  "from": "e2",
  "to": "e4",
  "promotion": "q",
  "capturingKing": false
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `gameId` | string | Yes | |
| `from` | string | Yes | Square in algebraic notation (`"a1"`–`"h8"`) |
| `to` | string | Yes | Target square |
| `promotion` | string | No | `"q"` \| `"r"` \| `"b"` \| `"n"` — only for pawn promotions |
| `capturingKing` | boolean | No | `true` when the move captures the opponent's king (custom StepUp rule) |

**Response**
```json
{
  "fen": "<FEN string>",
  "moveHistory": ["e2e4", "e7e5"],
  "cost": 60,
  "newBalance": 940
}
```

**Side effects**
- Updates `fen` and `moveHistory` in `RTDB /games/{gameId}` (RTDB only — hot path)
- Deducts cost from `RTDB /games/{gameId}/steps/{uid}/balance`
- Increments `totalStepsSpent` and `totalMovesPlayed` in `Firestore leaderboard/{uid}`

**Errors**
| Code | Reason |
|---|---|
| `unauthenticated` | No auth token |
| `invalid-argument` | Missing fields, no piece at `from`, or illegal move |
| `not-found` | Game does not exist |
| `failed-precondition` | Game not active, or insufficient step balance |
| `permission-denied` | Caller is not a player in this game |

**StepUp free-play rule:** Either player may move at any time. The FEN's active color is aligned to the caller before chess.js validation, so turn enforcement is bypassed.

**King capture rule:** chess.js forbids king captures. Pass `capturingKing: true` to bypass validation; the function removes the king and places the attacker directly. King captures cost double in `fixed` cost mode.

---

### `endGame`

Marks a game as completed or abandoned. Updates leaderboard stats (wins / losses / draws) for completed games.

**Trigger:** HTTPS Callable
**Auth:** Required

**Request**
```json
{
  "gameId": "<string>",
  "outcome": "win"
}
```

| Field | Type | Values |
|---|---|---|
| `outcome` | string | `"win"` — caller won \| `"draw"` — mutual draw \| `"abandoned"` — no stats recorded |

**Response**
```json
{ "success": true }
```

**Side effects**
- Sets `status` to `completed` or `abandoned` in RTDB + Firestore
- Clears `RTDB /userActiveGame/{uid}` for both players
- If `completed`: increments `wins`/`losses` or `draws` in `Firestore leaderboard/`

**Errors**
| Code | Reason |
|---|---|
| `unauthenticated` | No auth token |
| `invalid-argument` | Missing gameId or outcome |
| `not-found` | Game does not exist |
| `permission-denied` | Caller is not a player in this game |

---

### `submitStepDelta`

Called by the Flutter pedometer integration to credit steps earned during an active game. Steps are game-scoped — they accumulate from game-start to game-end and live entirely in RTDB under the game node.

**Trigger:** HTTPS Callable
**Auth:** Required

**Request**
```json
{
  "gameId": "<string>",
  "delta": 250
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `gameId` | string | Yes | Active game the steps apply to |
| `delta` | number | Yes | Positive integer; must not exceed `max_step_delta_per_call` |

**Response**
```json
{ "newBalance": 1250 }
```

**Side effects**
- Atomically increments `RTDB /games/{gameId}/steps/{uid}/balance`

**Errors**
| Code | Reason |
|---|---|
| `unauthenticated` | No auth token |
| `invalid-argument` | Missing gameId, non-integer delta, delta ≤ 0, or delta exceeds RC cap |
| `not-found` | Game does not exist |
| `failed-precondition` | Game is not active |
| `permission-denied` | Caller is not a player in this game |

---

### `onUserCreated`

Triggered automatically by Firebase Auth when a new account is created. Not callable by clients.

**Side effects**
- `RTDB /steps/{uid}/balance` → `0`
- `Firestore users/{uid}` → `UserProfile`
- `Firestore leaderboard/{uid}` → `PlayerStats` (all zeros)

---

### `updateDisplayName`

Syncs a new display name across both `users/` and `leaderboard/` atomically.

**Trigger:** HTTPS Callable
**Auth:** Required

**Request**
```json
{ "displayName": "Alice" }
```

**Response**
```json
{ "success": true }
```

---

### `matchmakingOnQueueWrite`

RTDB trigger — **not callable by clients**. Fires when any player writes to `/queue/{userId}`. Reads the queue in FIFO order (by `joinedAt`) and pairs the two oldest players into a new active game.

The client writes `{ joinedAt: ServerValue.TIMESTAMP }` to `/queue/{uid}` to enter the queue, and watches `/matches/{uid}/gameId` to receive the paired game ID.

---

## Database Schema

### Realtime Database

```
/games/{gameId}
  id            : string
  whitePlayerId : string
  blackPlayerId : string | null
  fen           : string          # current board state (FEN)
  moveHistory   : string[]        # e.g. ["e2e4", "e7e5q"]
  status        : "waiting" | "active" | "completed" | "abandoned"
  presetName    : string          # "Quick" | "Normal" | "Marathon"
  costModeName  : string          # "baseDistance" | "distance" | "fixed"
  createdAt     : string          # ISO 8601

  /steps/{uid}
    balance     : number          # game-scoped step balance

/userActiveGame/{uid}    : string   # current gameId, or absent if idle
/queue/{uid}
  joinedAt      : number           # server timestamp (for FIFO pairing)
/matches/{uid}
  gameId        : string           # written by matchmaking trigger
/steps/{uid}
  balance       : number           # global step balance (initialised on account creation)
```

### Firestore

```
games/{gameId}             # mirror of RTDB game (updated on create / join / end)
users/{uid}
  id            : string
  displayName   : string
  avatarColor   : number    # ARGB int matching Dart's Color format
  isOnline      : bool
leaderboard/{uid}
  userId        : string
  displayName   : string
  wins          : number
  losses        : number
  draws         : number
  totalStepsSpent  : number
  totalMovesPlayed : number
```

---

## Step Cost System

### Presets

| Preset | Pawn | Knight | Bishop | Rook | Queen | King | distanceCost |
|---|---|---|---|---|---|---|---|
| Quick | 2 | 5 | 5 | 7 | 10 | 3 | 1 |
| Normal | 50 | 80 | 80 | 100 | 150 | 30 | 10 |
| Marathon | 200 | 350 | 350 | 500 | 750 | 100 | 50 |

### Cost Modes

| Mode | Formula |
|---|---|
| `baseDistance` | `baseCost + distance × distanceCost` |
| `distance` | `distance × distanceCost` |
| `fixed` | `baseCost` (×2 for king captures) |

### Distance Metric

- **Knights:** Manhattan distance — `|dx| + |dy|` (always 3 for a legal L-move)
- **All other pieces:** Chebyshev distance — `max(|dx|, |dy|)`

The preset and cost mode are locked per game at creation time and stored in the game document.

---

## Configuration & Feature Flags

Remote Config keys (with hardcoded defaults used in the emulator):

| Key | Default | Purpose |
|---|---|---|
| `max_step_delta_per_call` | 10 000 | Anti-cheat cap on steps per `submitStepDelta` call |
| `max_steps_per_hour` | 50 000 | Anti-cheat cap on steps per hour (not yet enforced server-side) |
| `enable_matchmaking` | `true` | Feature flag |
| `enable_leaderboard` | `true` | Feature flag |
| `enable_chat` | `true` | Feature flag |
| `max_move_history_length` | 500 | Max moves stored per game |

Remote Config is fetched once per cold start and cached for the function instance lifetime. If the template hasn't been published yet (emulator, first deploy), `config.service.ts` falls back to the defaults above so functions still work locally.

---

## Security Model

- **All balance mutations** are performed by Cloud Functions only. Client write rules are `false` for balances, game state, and leaderboard.
- **Caller identity** is always read from `request.auth.uid` (Firebase Auth bearer token), never from the request body.
- **App Check** is enforced on all callable functions (`enforceAppCheck: true`). RTDB triggers cannot use App Check.
- **RTDB rules:** clients have read access to `/games/` and write access only to `/queue/{uid}`. Everything else is written by Cloud Functions.
- **Firestore rules:** clients can read public collections (`users`, `games`, `leaderboard`). Writes go through Cloud Functions only, except `friendRequests` (allowed from the initiating user).

---

## Adding a New Function

1. **Add the handler** in `functions/src/functions/my-feature.functions.ts`
2. **Add business logic** (if any) in `functions/src/services/my-feature.service.ts`
3. **Add data access** (if any) in `functions/src/repositories/my-feature.repository.ts`
4. **Add instance config** in `functions/src/config/instances.ts`
5. **Export** from `functions/src/index.ts`

Keep handlers thin — auth check + input validation + delegate to service/repository + return.

---

## Deployment

```bash
# Deploy to dev
make deploy-dev

# Deploy to prod
make deploy-prod
```

Both targets run `npm run build` before deploying and push functions + security rules.

To deploy only rules without redeploying functions:
```bash
firebase deploy --only firestore:rules,database
```

To deploy a single function:
```bash
firebase deploy --only functions:makeMove
```
