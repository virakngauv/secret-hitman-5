# Gameplay state machine

```text
lobby
  └─ host starts with 2–12 players
       ↓
hinting
  ├─ each starting player selects 1–5 targets from eight editable words around three locked civilians and a locked assassin
  ├─ the selection count becomes the hint number
  └─ after all hints are submitted, the host manually selects “Start guessing”
       ↓
guessing
  ├─ one clue-giver turn per starting player
  ├─ players guess, stop voluntarily, or stop on civilian/assassin
  ├─ host advances non-final turns only after all eligible pickers finish
  └─ the completed final board remains visible until the host selects “View scoreboard”
       ↓
finished
  ├─ show board-free final standings
  └─ host returns every connected member to the same lobby before another game can start
```

## Personalized information

- During hinting, a starting player receives only their own private board. Spectators receive readiness status but no board.
- During guessing, the clue-giver and finished pickers see every card type on the current board. Passing or selecting a civilian immediately ends that picker's turn and privately reveals the board. Active pickers and spectators see only publicly claimed target/civilian types until the board completes.
- The first accepted assassin claim completes the board for every picker and reveals all roles and claimant attribution to every player and spectator. Finished pickers cannot make additional picks, including after a refresh or reconnect.
- At the end of the game, the final board is fully revealed to everyone until the host opens the dedicated scoreboard. The results snapshot contains standings but no board or guessing controls.

## Claim ordering

The server synchronously accepts claims against current turn and card state. Every card has one successful claimant; concurrent later target or civilian requests receive `already_claimed`. The first assassin claim marks every eligible picker done, and later in-flight claims are rejected. Command retries return their remembered result without repeating scoring effects.

Each active-game snapshot includes an opaque `gameId`, and each guessing snapshot also includes an opaque `turnId` (server-generated UUIDs). Game commands echo the game ID; claims and passes echo both IDs. The turn ID stays fixed throughout one turn and changes on advancement. The game ID changes only when a new game starts. Delayed commands from a completed game or guessing turn are rejected before applying any effects.

Validation and claim application are synchronous: current player eligibility, tile membership, and ownership decide whether a move succeeds. Retries in the same turn return the remembered result without scoring twice, including after the accepted move ends the picker’s turn. Advancing clears the per-turn result cache. A repeated pass in the same turn succeeds without changing scores or room lifetime; it does not need a separate result cache.

### Revision removal audit (#25)

Room revisions are removed completely, not retained as a second identity mechanism:

- Server counter, increments, and turn-window bookkeeping: replaced by explicit turn identity; activity timestamps still track meaningful changes.
- Snapshots and client payloads: no counter remains. The provider already applies snapshots without revision comparisons. Broadcasts read authoritative state immediately before emission; reconnect resumes current state, and callbacks from replaced sockets are ignored. Socket.IO delivers packets in connection order; no counter-based ordering consumer was found.
- Board initialization: uses the existing private initial seed and start time without a room counter. Default initial seeds already contain random entropy. Explicit fixed test seeds remain reproducible and do not control public turn identities.
- Tests and smoke script: assert actual state, ownership, scores, and restored turn identity instead of treating counter increments as evidence of correctness.

Protocol version 9 combines game and turn identity with the unified locked-role, target-count, scoring, board-completion, final-results, lobby-reset, and reversible hint-lock contracts. Deploy the frontend and game server together; older clients must reload to reconnect. No compatibility shim accepts commands without the current game identity.

## Host advancement

Both “Next hint” and “View scoreboard” require every eligible picker on the current board to finish. Only non-final turns accept advancement; the final turn accepts the separate scoreboard transition. The server checks current game and turn state before changing the turn or phase, and snapshots drive the host's disabled control and waiting message. A stale client or repeated command cannot skip an active guessing turn. Rejected transitions do not change the board, scores, player turns, or room activity time.

Passing, selecting a civilian, or explicitly leaving completes that picker's turn. Claiming the last target or the first assassin completes all pickers, so no extra passes are required. The clue-giver, spectators, and inactive seats do not block advancement; a host who is also a picker must finish along with everyone else. Completion enables the host action without automatically advancing.

Temporary disconnects do not change membership or guessing eligibility and therefore continue to block advancement until the picker reconnects and finishes, or all targets are found. There is no timeout-based abandonment or host force-advance override. Explicit leave preserves its existing finish-turn behavior; rejoining does not reopen guessing on that board.

## Membership

Room membership is independent from a Socket.IO connection. Disconnecting does not remove a player. Explicitly leaving during a game preserves the historical seat and score; reconnecting with the same browser token restores it. A new identity joining after the lobby is assigned spectator participation and cannot submit hints, claim cards, or enter the player standings.

From final results, only the host can return the room to the lobby. The transition preserves the room code, host, active membership, and removal restrictions while clearing the completed game's boards, seats, roles, hints, turns, scores, results, and retry cache. Active spectators become ordinary lobby players and can join the next game under the normal 2–12 player limit. A repeated return request is idempotent. The next game receives a new game ID and freshly generated private boards only after the host selects the lobby's normal “Start game” action.

Explicitly leaving during guessing ends the picker's turn, like passing. Rejoining restores a finished, privately revealed view, never eligibility to guess again on that board. This reveals no more than the freely available pass action; transport disconnect alone does not finish the turn or reveal hidden roles.

### Guest identity security boundary

The browser persists a randomly generated 128-bit guest token in localStorage and sends it in the Socket.IO handshake. This is a bearer credential for room membership, including host actions; it is not a Clerk account credential. Production socket connections require HTTPS. Rooms and their membership state are in memory and disappear on expiry or server restart.

The token remains readable by same-origin JavaScript. XSS or a compromised third-party script could steal it and impersonate that guest in surviving rooms. HTTPS does not prevent this risk. Do not treat guest identity as suitable for sensitive account data or privileged non-game actions.

Moving to a server-issued HttpOnly cookie requires a coordinated session protocol and deployment design: the frontend and game server can be on different sites, and cookie delivery, cross-origin credentials, origin/CSRF protections, local development, and reconnect migration must be tested together. A same-origin gateway or another explicitly designed session boundary is future security work; the current localStorage model does not provide HttpOnly protection.

## Fixed clue-building roles

Each 12-word board receives three locked civilians and one locked assassin. The server selects distinct positions using a separate seeded shuffle at board creation; rerenders, refreshes, and reconnects reuse the stored assignments. The eight remaining words stay editable. Player-submitted target IDs must contain one through five distinct editable cards and exclude locked roles; invalid requests leave the board and ready status unchanged. A player who leaves before submitting receives an internal zero-target `PASS` fallback so the room can continue. Unselected editable non-assassin cards become civilians while the hint is submitted. The clue-maker keeps a private, read-only view of their submitted hint and board and may unlock it while hinting remains open; unlocking preserves the hint and selected targets, presents unselected editable cards as available again, and clears readiness until the hint is resubmitted. Only the clue-maker receives their private hinting board, hint, and lock metadata. Guessing snapshots do not expose locks.
