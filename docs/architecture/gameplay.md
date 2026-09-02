# Gameplay state machine

```text
lobby
  └─ host starts with 2–12 players
       ↓
hinting
  ├─ each current participant selects 1–5 targets from eight editable words around three locked civilians and a locked assassin
  ├─ the selection count becomes the hint number
  ├─ visitors may join as participants until guessing starts
  ├─ each submitted clue and number appears immediately to everyone, and the host may reject it while other players are still choosing, replacing that player's private board and clearing the rejected clue
  └─ the host manually selects “Start guessing” after every accepted or revised hint is submitted
       ↓
guessing
  ├─ one clue-giver turn per accepted participant
  ├─ players guess, stop voluntarily, or stop on civilian/assassin
  ├─ the latest public claim or pass explains who acted, why a picker or board finished, and what happens next
  ├─ host advances non-final turns normally when everyone finishes, or after a count-based warning while pickers remain
  └─ the final board remains visible until the host selects “View scoreboard,” with the same unfinished-picker warning when needed
       ↓
finished
  ├─ show board-free final standings
  └─ host returns every connected member to the same lobby before another game can start
```

## Personalized information

- During hinting, each participant receives only their own private board. A submitted clue and number become visible immediately to every player and spectator without exposing its board or selected targets. The host may reject any submitted non-host clue while other participants are still choosing, giving that player a fresh private board for the revision.
- During guessing, the clue-giver and finished pickers see every card type on the current board. Passing or selecting a civilian immediately ends that picker's turn and privately reveals the board. Active pickers and spectators see only publicly claimed target/civilian types until the board completes.
- Every guessing snapshot carries the latest public target, civilian, assassin, or pass narrative. It includes only the acting picker, the public word when applicable, the already-public role, the resulting completion state, and the next expected action. The server stores this state with the turn so every player and spectator receives the same narrative after refresh or reconnect.
- The first accepted assassin claim completes the board for every picker and reveals all roles and claimant attribution to every player and spectator. Finished pickers cannot make additional picks, including after a refresh or reconnect.
- At the end of the game, the final board is fully revealed to everyone until the host opens the dedicated scoreboard. The results snapshot contains standings but no board or guessing controls.

## Claim ordering

The server synchronously accepts claims against current turn and card state. Every card has one successful claimant; concurrent later target or civilian requests receive `already_claimed`. The first assassin claim marks every eligible picker done, and later in-flight claims are rejected. Command retries return their remembered result without repeating scoring effects.

Each active-game snapshot includes an opaque `gameId`, and each guessing snapshot also includes an opaque `turnId` (server-generated UUIDs). Game commands echo the game ID; claims, passes, advancement, and final-scoreboard commands echo both IDs. The turn ID stays fixed throughout one turn and changes on advancement. The game ID changes only when a new game starts. Delayed or repeated commands from a completed game or guessing turn are rejected before applying any effects, so a retry cannot skip multiple boards.

Validation and claim application are synchronous: current player eligibility, tile membership, and ownership decide whether a move succeeds. Retries in the same turn return the remembered result without scoring twice, including after the accepted move ends the picker’s turn. Advancing clears the per-turn result cache. A repeated pass in the same turn succeeds without changing scores or room lifetime; it does not need a separate result cache.

### Revision removal audit (#25)

Room revisions are removed completely, not retained as a second identity mechanism:

- Server counter, increments, and turn-window bookkeeping: replaced by explicit turn identity; activity timestamps still track meaningful changes.
- Snapshots and client payloads: no counter remains. The provider already applies snapshots without revision comparisons. Broadcasts read authoritative state immediately before emission; reconnect resumes current state, and callbacks from replaced sockets are ignored. Socket.IO delivers packets in connection order; no counter-based ordering consumer was found.
- Board initialization: uses the existing private initial seed and start time without a room counter. Default initial seeds already contain random entropy. Explicit fixed test seeds remain reproducible and do not control public turn identities.
- Tests and smoke script: assert actual state, ownership, scores, and restored turn identity instead of treating counter increments as evidence of correctness.

Protocol version 12 combines explicit game and turn identity with the unified locked-role, target-count, scoring, board-completion, final-results, acknowledged lobby-reset notice, reversible hint-lock, shared hint-review, clue rejection, hinting-phase membership, departure intent, public activity, host override, succession, and participant-removal contracts. Deploy the frontend and game server together; older clients must reload to reconnect. No compatibility shim accepts commands without the current game identity or older command and snapshot shapes.

## Host advancement

“Next hint” and “View scoreboard” remain enabled for the host throughout guessing. When every eligible picker has finished, the command runs normally. When one or more pickers remain, the client names only the count and requires a concise Cancel/Move on confirmation. Confirming performs the ordinary authoritative transition: accepted scores and claims remain, every participant stays in history, and no pass, penalty, forfeit, abandonment, or special notification is fabricated. Only non-final turns accept advancement; the final turn accepts the separate scoreboard transition. Both commands carry the current turn ID, so a stale or repeated command cannot skip multiple boards.

Passing, selecting a civilian, or explicitly leaving completes that picker's turn. Claiming the last target or the first assassin completes all pickers, so no extra passes are required. The clue-giver, spectators, and inactive seats do not block advancement; a host who is also a picker must finish along with everyone else. Completion enables the host action without automatically advancing.

Temporary transport disconnects do not change membership or guessing eligibility. The picker may reconnect and continue, while the host can use the warned transition or explicitly remove someone who has left permanently. Explicit leave and finalized exit intents end eligibility immediately; rejoining later does not reopen guessing on that board.

## Membership

Room membership is independent from a Socket.IO connection. Disconnecting alone does not remove a player, so reconnecting with the same browser token restores the existing seat. When the last same-document route watcher leaves a room, the client defers the normal Socket.IO leave command long enough for an immediate React remount to cancel it. On document exit, the client sends a best-effort authenticated beacon instead. The server waits through a short reconnect grace period, cancels the intent when the identity resumes through a different connection, ignores it while another tab for that identity remains active, and otherwise performs the normal leave transition. The socket that originated the intent is not itself evidence of a reconnect and is removed from the Socket.IO room when the intent settles. Reload, navigation, browser restoration, duplicate intents, and multiple tabs therefore do not rely on a guaranteed browser “closed forever” signal. If the browser cannot deliver the beacon, ordinary reconnect behavior and host controls remain the fallback.

Explicitly leaving during hinting removes the current board, clue, readiness, score, and turn-order entry without banning the identity. When either departure leaves only one participant in a two-player round, the server abandons the round and returns the remaining player to a one-player lobby behind an explanatory acknowledgement dialog; Start game remains disabled until another player joins. Rejoining while clue creation remains open creates a fresh participant seat and board; rejoining after guessing starts admits that identity as a spectator. A new identity joining during hinting receives a participant seat when fewer than 12 seats exist; after the cutoff, or at the participant cap, it receives spectator participation and cannot submit hints, claim cards, or enter the player standings.

From final results, only the host can return the room to the lobby. The transition preserves the room code, host, active membership, and removal restrictions while clearing the completed game's boards, seats, roles, hints, turns, scores, results, and retry cache. Active spectators become ordinary lobby players and can join the next game under the normal 2–12 player limit. A repeated return request is idempotent. The next game receives a new game ID and freshly generated private boards only after the host selects the lobby's normal “Start game” action.

Explicitly leaving during guessing removes the identity from current and future guessing eligibility. A not-yet-started authored turn is skipped; an already active authored board remains intact for the remaining pickers or warned host advancement. Rejoining restores spectator participation, never eligibility or private-board visibility. Transport disconnect alone does not finish the turn or reveal hidden roles.

During hinting, a new identity becomes a participant while fewer than 12 game seats exist. The server synchronously appends a private board and turn-order seat, so a join accepted before a start-guessing command makes readiness incomplete; a start accepted first closes participation and later identities become spectators. The host may remove a non-host participant. Removal deletes that board, hint, readiness, score, and future turn and preserves the room's token ban. Removing the only other participant requires explicit confirmation, abandons the current round, clears all round state, and returns every remaining identity to the lobby as a player while preserving the room code and removal bans.

During guessing, host removal deactivates the participant and ends their current and future guessing eligibility without rewriting accepted history. The removed participant is excluded from public scoreboards and winners, and retained current-turn attribution uses `xxxx` instead of their name. Points already awarded to other players and completed board history remain unchanged. A not-yet-started authored turn is removed from the remaining rotation; an already active authored board remains intact for the other pickers or warned host advancement. The removed identity cannot act or rejoin.

## Host succession

Only explicit or finalized host leave transfers authority; disconnect, reconnect, and additional sockets never do. The successor is the earliest active game participant by original join time. The earliest active spectator becomes operational host only when no active participant remains. Host authority stays separate from player participation: a spectator-host may start guessing, move between turns, show results, and return to the lobby, but cannot submit a clue, claim, pass, or receive unrevealed roles. The UI labels this fallback and explains the restricted controls.

### Guest identity security boundary

The browser persists a randomly generated 128-bit guest token in localStorage and sends it in the Socket.IO handshake. This is a bearer credential for room membership, including host actions; it is not a Clerk account credential. Production socket connections require HTTPS. Rooms and their membership state are in memory and disappear on expiry or server restart.

The token remains readable by same-origin JavaScript. XSS or a compromised third-party script could steal it and impersonate that guest in surviving rooms. HTTPS does not prevent this risk. Do not treat guest identity as suitable for sensitive account data or privileged non-game actions.

Moving to a server-issued HttpOnly cookie requires a coordinated session protocol and deployment design: the frontend and game server can be on different sites, and cookie delivery, cross-origin credentials, origin/CSRF protections, local development, and reconnect migration must be tested together. A same-origin gateway or another explicitly designed session boundary is future security work; the current localStorage model does not provide HttpOnly protection.

## Fixed clue-building roles

Each 12-word board receives three locked civilians and one locked assassin. The server selects distinct positions using a separate seeded shuffle at board creation; rerenders, refreshes, and reconnects reuse the stored assignments. The eight remaining words stay editable. Player-submitted target IDs must contain one through five distinct editable cards and exclude locked roles; invalid requests leave the board and ready status unchanged. Explicitly leaving during hinting removes the entire current-round seat rather than synthesizing a clue or retaining its board. Unselected editable non-assassin cards become civilians while the hint is submitted. The clue-maker keeps a private, read-only view of their submitted hint and board and may unlock it while hinting remains open; unlocking preserves the hint and selected targets, presents unselected editable cards as available again, and clears readiness until the hint is resubmitted. Only the clue-maker receives their private hinting board, hint, and lock metadata. Guessing snapshots do not expose locks.
