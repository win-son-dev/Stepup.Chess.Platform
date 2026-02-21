# StepUp Chess — Backend Implementation Guide

This document describes the full backend architecture: what every model, service, and repository does, what is already built, and exactly what still needs to be implemented.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Real-time game state | Firebase Realtime Database (RTDB) | Sub-millisecond sync, ideal for live game data |
| User profiles / leaderboard | Cloud Firestore | Structured queries, search |
| Step transaction history | Cloud Firestore | Ordered querying, pagination |
| Step balance (authoritative) | RTDB (written by Cloud Functions only) | Tamper-proof currency |
| Matchmaking queue | RTDB | Presence-style writes with timestamps |
| Authentication | Firebase Auth | Email/password + anonymous fallback |
| Server-side logic | Cloud Functions (Node.js) | Authoritative moves, balance updates |

---

## Database Layout

### Realtime Database

```
/steps/{userId}/
  balance: int                    # authoritative step balance — written by Cloud Functions ONLY

/games/{gameId}/                  # live game state — written by Cloud Functions ONLY
  id: string
  whitePlayerId: string
  blackPlayerId: string | null
  fen: string                     # current board position
  moveHistory: string[]           # list of UCI move strings e.g. ["e2e4","e7e5"]
  status: "waiting"|"active"|"completed"|"abandoned"
  presetName: string
  costModeName: string
  createdAt: string               # ISO 8601

/queue/{userId}/
  joinedAt: ServerTimestamp       # matchmaking presence — deleted when matched or left

/matches/{userId}/
  gameId: string                  # written by matchmaking Cloud Function when a match is found
```

### Firestore

```
users/{userId}
  id: string
  displayName: string
  avatarColor: int                # ARGB int
  isOnline: bool

leaderboard/{userId}
  userId: string
  displayName: string
  wins: int
  losses: int
  draws: int
  totalStepsSpent: int
  totalMovesPlayed: int

stepTransactions/{userId}/transactions/{txId}
  amount: int                     # positive = earn, negative = spend
  balanceAfter: int
  source: "pedometer"|"move"|"king_capture"|"debug"
  timestamp: string               # ISO 8601
  gameId?: string
  piece?: string
  moveFrom?: string
  moveTo?: string

friendRequests/{userId}/incoming/{fromUserId}
  fromUserId: string
  status: "pending"|"accepted"
  createdAt: string

games/{gameId}/messages/{msgId}   # in-game chat
  id: string
  gameId: string
  userId: string
  displayName: string             # denormalized at send time
  content: string
  timestamp: string               # ISO 8601
```

---

## Models

All models live in `lib/models/`. They are plain Dart classes with no Flutter or Firebase dependencies — serialization is done via `toMap()` / `fromMap()`.

### `OnlineGame` (`models/online_game.dart`)

Represents a single chess game session.

| Field | Type | Description |
|---|---|---|
| `id` | `String` | RTDB push key |
| `whitePlayerId` | `String` | Firebase Auth UID |
| `blackPlayerId` | `String?` | Null while game is in `waiting` state |
| `fen` | `String` | Current board position in FEN notation |
| `moveHistory` | `List<String>` | UCI move strings in order e.g. `e2e4` |
| `status` | `OnlineGameStatus` | `waiting` → `active` → `completed`/`abandoned` |
| `presetName` | `String` | Step cost preset (e.g. `"balanced"`) |
| `costModeName` | `String` | Cost mode (e.g. `"normal"`) |
| `createdAt` | `DateTime` | When the game was created |

### `UserProfile` (`models/user_profile.dart`)

Player identity shown in UI (name, avatar).

| Field | Type | Description |
|---|---|---|
| `id` | `String` | Firebase Auth UID |
| `displayName` | `String` | Shown on board and leaderboard |
| `avatarColor` | `int` | ARGB int — no Flutter dependency in model |
| `isOnline` | `bool` | Presence flag updated by client |

### `PlayerStats` (`models/player_stats.dart`)

Aggregated lifetime stats for leaderboard. Has `winRate` computed getter.

| Field | Type | Description |
|---|---|---|
| `userId` | `String` | Firebase Auth UID |
| `displayName` | `String` | Denormalized for leaderboard queries |
| `wins` | `int` | Games won |
| `losses` | `int` | Games lost |
| `draws` | `int` | Games drawn |
| `totalStepsSpent` | `int` | Cumulative steps spent on moves |
| `totalMovesPlayed` | `int` | Total move count across all games |

### `ChatMessage` (`models/chat_message.dart`)

In-game chat message. `displayName` is denormalized at send time so profile renames don't affect history.

| Field | Type | Description |
|---|---|---|
| `id` | `String` | Firestore document ID |
| `gameId` | `String` | Parent game |
| `userId` | `String` | Sender UID |
| `displayName` | `String` | Sender name at time of send |
| `content` | `String` | Message text |
| `timestamp` | `DateTime` | Send time |

### `StepTransaction` (`models/step_transaction.dart`)

Immutable ledger entry for every step balance change. `isEarn` / `isSpend` computed getters.

| Field | Type | Description |
|---|---|---|
| `id` | `String` | Firestore document ID (passed to `fromMap`) |
| `amount` | `int` | Positive = earned, negative = spent |
| `balanceAfter` | `int` | Snapshot of balance after this transaction |
| `source` | `StepTransactionSource` | `pedometer`, `move`, `kingCapture`, `debug` |
| `timestamp` | `DateTime` | When it occurred |
| `gameId` | `String?` | Set for move/king-capture sources |
| `piece` | `String?` | Piece type that moved (e.g. `"N"`) |
| `moveFrom` | `String?` | Origin square (e.g. `"e2"`) |
| `moveTo` | `String?` | Destination square (e.g. `"e4"`) |

---

## Services

Services handle platform integration and cross-cutting concerns. They live in `lib/services/`.

### `AuthService` (abstract) — `services/auth_service.dart`

Provides the current authenticated user ID.

```dart
Future<String> signIn();       // returns userId, creates session if needed
String? get currentUserId;     // null if not signed in
```

**Implementations:**
- `FirebaseAuthService` — **IMPLEMENTED.** Email/password via `firebase_ui_auth`. Falls back to `signInAnonymously()` if no account. Also exposes `authStateChanges` stream and `configureProviders()` for the sign-in screen.
- `MockAuthService` — **IMPLEMENTED.** Generates a UUID on first run and persists it in `SharedPreferences`.

---

### `StepSyncService` (abstract) — `services/step_sync_service.dart`

Synchronizes step balance with the server. Step balance is treated as currency — only Cloud Functions may write it.

```dart
// Submit earned steps to server (routes through Cloud Function)
Future<void> submitDelta(String userId, int delta, {String source = 'pedometer'});

// Server-authoritative live balance — reads RTDB /steps/{userId}/balance
Stream<int> watchBalance(String userId);

// Step transaction history from Firestore
Stream<List<StepTransaction>> watchRecentTransactions(String userId, {int limit = 20});
```

**Implementations:**
- `RealtimeStepSyncService` — **IMPLEMENTED.** Uses RTDB for balance, Firestore for transactions, delegates balance mutations to `CloudFunctionsService`.
- `MockStepSyncService` — **IMPLEMENTED.** In-memory balance/transactions with `StreamController`.

---

### `CloudFunctionsService` — `services/cloud_functions_service.dart`

Thin client wrapper around Firebase HTTPS Callable functions. All server-side business logic is invoked through here.

**Currently implemented (client side only):**

```dart
// Atomically increments RTDB balance and writes earn transaction to Firestore
Future<void> submitStepDelta(String userId, int delta, {String source});
```

**Needs to be added (as the Cloud Functions are built):**

```dart
Future<String> createGame(String whitePlayerId, String presetName, String costModeName);
Future<void> joinGame(String gameId, String blackPlayerId);
Future<void> makeMove(String gameId, String playerId, String from, String to, {String? promotion});
Future<void> endGame(String gameId, String finalStatus);
```

---

### `StepTrackerService` — `services/step_tracker_service.dart`

**IMPLEMENTED.** The pedometer integration layer. Owns the local step bag and bridges hardware steps to the sync layer.

- Subscribes to `pedometer_2` step count stream
- Maintains a baseline/last-known-steps in `SharedPreferences` to survive reboots
- Exposes `stepBagStream` (broadcast `Stream<int>`) for local UI
- Calls `StepSyncService.submitDelta()` for each earned batch
- `addSteps(int)` — debug method for testing without walking

---

## Repositories

Repositories own all data access. Every repository is an abstract class with a mock implementation. Firebase implementations do not yet exist and are what needs to be built.

They live in `lib/repositories/`. Mocks are in `lib/repositories/mock/`.

---

### `GameRepository` — `repositories/game_repository.dart`

Manages chess game lifecycle.

```dart
// Create a new game in waiting state
Future<OnlineGame> createGame({
  required String whitePlayerId,
  required StepCostPreset preset,
  required CostMode costMode,
});

// Join an existing waiting game as black player
// Throws GameNotFoundException or GameFullException
Future<OnlineGame> joinGame(String gameId, String blackPlayerId);

// Live stream of game state — must emit on every change (FEN, moves, status)
Stream<OnlineGame> watchGame(String gameId);

// Submit a move — server validates and returns updated game
Future<OnlineGame> makeMove({
  required String gameId,
  required String playerId,
  required String from,
  required String to,
  String? promotion,
});

// Mark a game as completed or abandoned
Future<void> endGame(String gameId, OnlineGameStatus finalStatus);

// Recent game history for a user
Future<List<OnlineGame>> getGamesForUser(String userId, {int limit = 20});
```

**To implement — `RTDBGameRepository`:**
- `createGame` → call `CloudFunctionsService.createGame()` → return `OnlineGame`
- `joinGame` → call `CloudFunctionsService.joinGame()`, handle exceptions from function result
- `watchGame(gameId)` → listen on RTDB `/games/{gameId}` → map snapshot to `OnlineGame.fromMap()`
- `makeMove` → call `CloudFunctionsService.makeMove()` → return updated `OnlineGame`
- `endGame` → call `CloudFunctionsService.endGame()`
- `getGamesForUser` → query Firestore `games` collection where `whitePlayerId == userId || blackPlayerId == userId`, ordered by `createdAt` descending

---

### `UserRepository` — `repositories/user_repository.dart`

Manages player profiles stored in Firestore `users/`.

```dart
// Get or create profile — upserts on first call for a new user
Future<UserProfile> getCurrentUser(String userId);

Future<void> updateDisplayName(String userId, String name);

Future<UserProfile?> getUser(String id);      // null if not found

Stream<UserProfile> watchUser(String id);

Future<List<UserProfile>> searchUsers(String query, {int limit = 20});
```

**To implement — `FirestoreUserRepository`:**
- `getCurrentUser` → read `users/{userId}`, if missing create with default display name + random `avatarColor`
- `updateDisplayName` → `update({'displayName': name})` on `users/{userId}`
- `getUser` → single `get()`, return null if `!snapshot.exists`
- `watchUser` → `.snapshots()` stream → `UserProfile.fromMap()`
- `searchUsers` → Firestore prefix query: `displayName >= query` and `displayName <= query + '\uf8ff'`

---

### `ChatRepository` — `repositories/chat_repository.dart`

In-game chat stored in Firestore `games/{gameId}/messages/`.

```dart
// Emits the full message list every time a new message arrives
Stream<List<ChatMessage>> watchMessages(String gameId);

Future<ChatMessage> sendMessage({
  required String gameId,
  required String userId,
  required String displayName,
  required String content,
});

// Paginated history, newest first
Future<List<ChatMessage>> getMessages(String gameId, {int limit = 50, DateTime? before});
```

**To implement — `FirestoreChatRepository`:**
- `watchMessages` → `games/{gameId}/messages` ordered by `timestamp` asc → `.snapshots()` → map full doc list
- `sendMessage` → `add(message.toMap())` to subcollection → return `ChatMessage.fromMap(doc.id, data)`
- `getMessages` → query ordered by `timestamp` desc, apply `.startAfter([before])` for pagination

---

### `LeaderboardRepository` — `repositories/leaderboard_repository.dart`

Player stats stored in Firestore `leaderboard/`.

```dart
// Returns PlayerStats.empty() if userId has no record yet
Future<PlayerStats> getStats(String userId);

// Atomically increments stat counters — use FieldValue.increment()
Future<void> updateStats({
  required String userId,
  required String displayName,
  int winsDelta = 0,
  int lossesDelta = 0,
  int drawsDelta = 0,
  int stepsSpentDelta = 0,
  int movesPlayedDelta = 0,
});

Future<List<PlayerStats>> getLeaderboard({int limit = 50});

Stream<PlayerStats> watchStats(String userId);
```

**To implement — `FirestoreLeaderboardRepository`:**
- `getStats` → read `leaderboard/{userId}`, return `PlayerStats.empty()` if missing
- `updateStats` → `set({...FieldValue.increment(delta)}, SetOptions(merge: true))` — safe for first write
- `getLeaderboard` → query `leaderboard` ordered by `wins` desc, limit
- `watchStats` → `.snapshots()` stream → `PlayerStats.fromMap()`

---

### `MatchmakingRepository` — `repositories/matchmaking_repository.dart`

Queues players and notifies when a match is found. Queue lives in RTDB for low-latency presence. Friend data lives in Firestore.

```dart
Future<void> enterQueue(String userId);        // write to RTDB /queue/{userId}
Future<void> leaveQueue(String userId);        // delete /queue/{userId}

// Emits once when RTDB /matches/{userId}/gameId appears, then closes
Stream<OnlineGame> watchMatchFound(String userId);

Future<List<UserProfile>> getFriends(String userId);
Future<void> sendFriendRequest(String from, String to);
Future<void> acceptFriendRequest(String from, String to);
Future<void> removeFriendRequest(String from, String to);
Stream<List<String>> watchPendingRequests(String userId);  // emits sender UIDs
```

**To implement — `RTDBMatchmakingRepository`:**
- `enterQueue` → `db.ref('queue/$userId').set({'joinedAt': ServerValue.timestamp})`
- `leaveQueue` → `db.ref('queue/$userId').remove()`
- `watchMatchFound` → listen on `db.ref('matches/$userId/gameId')` → when non-null, fetch game via `GameRepository.watchGame()`, emit once, cancel
- Friend methods → Firestore `friendRequests/{userId}/incoming/{fromUserId}` documents

---

## Cloud Functions (Not Yet Written)

The `functions/` directory does not exist. All functions must be Node.js HTTPS Callables deployed to Firebase.

### `submitStepDelta`

Called by `CloudFunctionsService.submitStepDelta()` when the pedometer earns steps.

**Input:** `{ userId, delta: int, source: string }`

**Logic:**
1. Validate `delta > 0`
2. Atomically increment RTDB `/steps/{userId}/balance` by `delta`
3. Read new balance from RTDB
4. Write `StepTransaction` to Firestore `stepTransactions/{userId}/transactions`

---

### `createGame`

**Input:** `{ whitePlayerId, presetName, costModeName }`

**Logic:**
1. Validate caller is `whitePlayerId`
2. Push new game object to RTDB `/games/` with `status: "waiting"`, initial FEN, empty `moveHistory`
3. Return `{ gameId }`

---

### `joinGame`

**Input:** `{ gameId, blackPlayerId }`

**Logic:**
1. Read RTDB `/games/{gameId}` — throw if not found or not `waiting`
2. Throw if `blackPlayerId == whitePlayerId` (can't play yourself)
3. Update RTDB `/games/{gameId}` — set `blackPlayerId`, `status: "active"`

---

### `makeMove`

Called whenever a player makes a move. This is the authoritative move validator.

**Input:** `{ gameId, playerId, from, to, promotion? }`

**Logic:**
1. Read RTDB `/games/{gameId}` — validate game is `active`
2. Validate it is the caller's turn
3. Load `StepCostPreset` by `presetName` — calculate step cost of the move
4. Read RTDB `/steps/{playerId}/balance` — reject if insufficient
5. Validate move legality using the chess engine (re-run on server)
6. Apply move to FEN — get new FEN
7. Atomically:
   - Update RTDB `/games/{gameId}` with new FEN, append move to `moveHistory`
   - Decrement RTDB `/steps/{playerId}/balance` by cost
   - Write spend `StepTransaction` to Firestore
8. Update `leaderboard/{playerId}` stats (`totalStepsSpent`, `totalMovesPlayed`) via `FieldValue.increment`
9. Return updated game

---

### `endGame`

**Input:** `{ gameId, finalStatus: "completed"|"abandoned" }`

**Logic:**
1. Update RTDB `/games/{gameId}/status`
2. Update `leaderboard/` for both players — increment `wins`/`losses`/`draws` based on outcome

---

### `matchmakingOnQueueWrite` (RTDB trigger)

Triggered on writes to `/queue/{userId}`.

**Logic:**
1. On create: read all entries in `/queue/`, sorted by `joinedAt`
2. If 2+ players are waiting, take the two oldest
3. Call `createGame` logic internally → get `gameId`
4. Write `gameId` to `/matches/{userId1}/gameId` and `/matches/{userId2}/gameId`
5. Delete both from `/queue/`

---

## Dependency Injection (`service_locator.dart`)

All services and repositories are registered as singletons via GetIt. The `useFirebase` flag controls whether real or mock implementations are used. Currently, repositories are always mocked even when `useFirebase = true` — this must be fixed as real implementations are built.

**Target wiring when `useFirebase = true`:**

```dart
getIt.registerSingleton<GameRepository>(RTDBGameRepository(...));
getIt.registerSingleton<UserRepository>(FirestoreUserRepository(...));
getIt.registerSingleton<ChatRepository>(FirestoreChatRepository(...));
getIt.registerSingleton<LeaderboardRepository>(FirestoreLeaderboardRepository(...));
getIt.registerSingleton<MatchmakingRepository>(RTDBMatchmakingRepository(...));
```

---

## Implementation Status

| Component | Status |
|---|---|
| `FirebaseAuthService` | Done |
| `MockAuthService` | Done |
| `RealtimeStepSyncService` | Done |
| `MockStepSyncService` | Done |
| `CloudFunctionsService` (client) | Done — callable wrapper only |
| `StepTrackerService` | Done |
| `submitStepDelta` Cloud Function | **Not built** |
| `createGame` Cloud Function | **Not built** |
| `joinGame` Cloud Function | **Not built** |
| `makeMove` Cloud Function | **Not built** |
| `endGame` Cloud Function | **Not built** |
| `matchmakingOnQueueWrite` RTDB trigger | **Not built** |
| `RTDBGameRepository` | **Not built** |
| `FirestoreUserRepository` | **Not built** |
| `FirestoreChatRepository` | **Not built** |
| `FirestoreLeaderboardRepository` | **Not built** |
| `RTDBMatchmakingRepository` | **Not built** |
| Firestore security rules (`firestore.rules`) | **Not built** |
| RTDB security rules (`database.rules.json`) | **Not built** |
| `firebase_options_prod.dart` | **Not built** |
| `lib/main_prod.dart` | **Not built** |

---

## Security Rules Sketch

### RTDB (`database.rules.json`)

```json
{
  "rules": {
    "steps": {
      "$userId": {
        ".read": "$userId === auth.uid",
        ".write": false
      }
    },
    "games": {
      "$gameId": {
        ".read": "auth != null",
        ".write": false
      }
    },
    "queue": {
      "$userId": {
        ".read": "$userId === auth.uid",
        ".write": "$userId === auth.uid"
      }
    },
    "matches": {
      "$userId": {
        ".read": "$userId === auth.uid",
        ".write": false
      }
    }
  }
}
```

### Firestore (`firestore.rules`)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId;
    }
    match /leaderboard/{userId} {
      allow read: if request.auth != null;
      allow write: if false; // Cloud Functions only
    }
    match /stepTransactions/{userId}/transactions/{txId} {
      allow read: if request.auth.uid == userId;
      allow write: if false; // Cloud Functions only
    }
    match /games/{gameId}/messages/{msgId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if false;
    }
    match /friendRequests/{userId}/incoming/{fromUserId} {
      allow read: if request.auth.uid == userId;
      allow write: if request.auth.uid == fromUserId;
    }
  }
}
```