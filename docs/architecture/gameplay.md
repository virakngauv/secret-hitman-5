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
  └─ host advances manually only after all eligible pickers finish
       ↓
finished
  └─ reveal the final board and final standings
```

## Personalized information

- During hinting, each participant receives only their own private board. A submitted clue and number become visible immediately to every player and spectator without exposing its board or selected targets. The host may reject any submitted non-host clue while other participants are still choosing, giving that player a fresh private board for the revision.
- During guessing, the clue-giver and finished pickers see every card type on the current board. Passing or selecting a civilian immediately ends that picker's turn and privately reveals the board. Active pickers and spectators see only publicly claimed target/civilian types until the board completes.
- The first accepted assassin claim completes the board for every picker and reveals all roles and claimant attribution to every player and spectator. Finished pickers cannot make additional picks, including after a refresh or reconnect.
- At the end of the game, the final board is fully revealed to everyone in the room.

## Claim ordering

The server synchronously accepts claims against current turn and card state. Every card has one successful claimant; concurrent later target or civilian requests receive `already_claimed`. The first assassin claim marks every eligible picker done, and later in-flight claims are rejected. Command retries return their remembered result without repeating scoring effects.

Each guessing snapshot includes an opaque `turnId` (a server-generated UUID). Claims and passes echo that ID. It stays fixed throughout one turn, including membership changes, other claims, and reconnects, and changes on advancement. A new game receives a fresh ID even if the room code, clock, players, and board seed are reused after a restart. It is independent of the private board seed, so publishing it cannot reveal hidden roles. Delayed commands with a different turn ID are rejected before applying any effects.

Validation and claim application are synchronous: current player eligibility, tile membership, and ownership decide whether a move succeeds. Retries in the same turn return the remembered result without scoring twice, including after the accepted move ends the picker’s turn. Advancing clears the per-turn result cache. A repeated pass in the same turn succeeds without changing scores or room lifetime; it does not need a separate result cache.

### Revision removal audit (#25)

Room revisions are removed completely, not retained as a second identity mechanism:

- Server counter, increments, and turn-window bookkeeping: replaced by explicit turn identity; activity timestamps still track meaningful changes.
- Snapshots and client payloads: no counter remains. The provider already applies snapshots without revision comparisons. Broadcasts read authoritative state immediately before emission; reconnect resumes current state, and callbacks from replaced sockets are ignored. Socket.IO delivers packets in connection order; no counter-based ordering consumer was found.
- Board initialization: uses the existing private initial seed and start time without a room counter. Default initial seeds already contain random entropy. Explicit fixed test seeds remain reproducible and do not control public turn identities.
- Tests and smoke script: assert actual state, ownership, scores, and restored turn identity instead of treating counter increments as evidence of correctness.

Protocol version 10 combines explicit turn identity with the unified locked-role, target-count, scoring, board-completion, reversible hint-lock, shared hint-review, clue rejection, hinting-phase membership, and participant-removal contracts. Deploy the frontend and game server together; older clients must reload to reconnect. No compatibility shim accepts older command or snapshot shapes.

## Host advancement

Both “Next hint” and “Finish the game” require every eligible picker on the current board to finish. The server checks current state before changing the turn or phase, and snapshots drive the host's disabled control and waiting message. A stale client or a repeated advance cannot skip an active guessing turn. Rejected advancement does not change the board, scores, player turns, or room activity time.

Passing, selecting a civilian, or explicitly leaving completes that picker's turn. Claiming the last target or the first assassin completes all pickers, so no extra passes are required. The clue-giver, spectators, and inactive seats do not block advancement; a host who is also a picker must finish along with everyone else. Completion enables the host action without automatically advancing.

Temporary disconnects do not change membership or guessing eligibility and therefore continue to block advancement until the picker reconnects and finishes, all targets are found, or the host explicitly removes that player. There is no timeout-based abandonment or host force-advance override. Explicit leave preserves its existing finish-turn behavior; rejoining does not reopen guessing on that board.

## Membership

Room membership is independent from a Socket.IO connection. Disconnecting does not remove a player, so reconnecting with the same browser token restores the existing seat. Explicitly leaving during hinting removes the current board, clue, readiness, score, and turn-order entry without banning the identity. Rejoining while clue creation remains open creates a fresh participant seat and board; rejoining after guessing starts admits that identity as a spectator. A new identity joining during hinting receives a participant seat when fewer than 12 seats exist; after the cutoff, or at the participant cap, it receives spectator participation and cannot submit hints, claim cards, or enter the player standings.

Explicitly leaving during guessing ends the picker's turn, like passing. Rejoining restores a finished, privately revealed view, never eligibility to guess again on that board. This reveals no more than the freely available pass action; transport disconnect alone does not finish the turn or reveal hidden roles.

During hinting, a new identity becomes a participant while fewer than 12 game seats exist. The server synchronously appends a private board and turn-order seat, so a join accepted before a start-guessing command makes readiness incomplete; a start accepted first closes participation and later identities become spectators. The host may remove a non-host participant. Removal deletes that board, hint, readiness, score, and future turn and preserves the room's token ban. Removing the only other participant requires explicit confirmation, abandons the current round, clears all round state, and returns every remaining identity to the lobby as a player while preserving the room code and removal bans.

During guessing, host removal deactivates the participant and finishes their current guessing eligibility without rewriting the established game. Their board, clue, turn-order position, score, and prior claims remain visible, and remaining players still guess a removed clue-giver's current or future board. The removed identity cannot act or rejoin, and it no longer blocks host advancement.

### Guest identity security boundary

The browser persists a randomly generated 128-bit guest token in localStorage and sends it in the Socket.IO handshake. This is a bearer credential for room membership, including host actions; it is not a Clerk account credential. Production socket connections require HTTPS. Rooms and their membership state are in memory and disappear on expiry or server restart.

The token remains readable by same-origin JavaScript. XSS or a compromised third-party script could steal it and impersonate that guest in surviving rooms. HTTPS does not prevent this risk. Do not treat guest identity as suitable for sensitive account data or privileged non-game actions.

Moving to a server-issued HttpOnly cookie requires a coordinated session protocol and deployment design: the frontend and game server can be on different sites, and cookie delivery, cross-origin credentials, origin/CSRF protections, local development, and reconnect migration must be tested together. A same-origin gateway or another explicitly designed session boundary is future security work; the current localStorage model does not provide HttpOnly protection.

## Fixed clue-building roles

Each 12-word board receives three locked civilians and one locked assassin. The server selects distinct positions using a separate seeded shuffle at board creation; rerenders, refreshes, and reconnects reuse the stored assignments. The eight remaining words stay editable. Player-submitted target IDs must contain one through five distinct editable cards and exclude locked roles; invalid requests leave the board and ready status unchanged. Explicitly leaving during hinting removes the entire current-round seat rather than synthesizing a clue or retaining its board. Unselected editable non-assassin cards become civilians while the hint is submitted. The clue-maker keeps a private, read-only view of their submitted hint and board and may unlock it while hinting remains open; unlocking preserves the hint and selected targets, presents unselected editable cards as available again, and clears readiness until the hint is resubmitted. Only the clue-maker receives their private hinting board, hint, and lock metadata. Guessing snapshots do not expose locks.
