# Gameplay state machine

```text
lobby
  └─ host starts with 2–12 players
       ↓
hinting
  ├─ each starting player selects 1–11 targets around a frozen assassin
  ├─ the selection count becomes the hint number
  └─ after all hints are submitted, the host manually selects “Start guessing”
       ↓
guessing
  ├─ one clue-giver turn per starting player
  ├─ players guess, stop voluntarily, or stop on civilian/assassin
  └─ host advances manually only after all eligible pickers finish
       ↓
finished
  └─ reveal the final board and final standings
```

## Personalized information

- During hinting, a starting player receives only their own private board. Spectators receive readiness status but no board.
- During guessing, the clue-giver and finished pickers see every card type on the current board. Passing or selecting a civilian/assassin immediately ends that picker's turn and privately reveals the board. Active pickers and spectators see only publicly claimed target/civilian types.
- An assassin's location and claimant list remain hidden from active pickers and spectators after it is selected, allowing each picker to independently risk it. Finished pickers cannot make additional picks, including after a refresh or reconnect.
- At the end of the game, the final board is fully revealed to everyone in the room.

## Claim ordering

The server synchronously accepts claims against current turn and card state. Targets and civilians have one successful claimant; concurrent later requests receive `already_claimed`. An assassin can be selected once by each eligible picker without globally disabling it. Command retries return their remembered result without repeating scoring effects.

Snapshot revisions from the current turn remain valid for claims, so simultaneous assassin picks do not invalidate one another. Revisions predating the current guessing turn or ahead of the server are rejected. Turn eligibility, card ownership, and scoring are always checked/applied on the server. Advancing resets turn eligibility and the minimum accepted revision; a previous private reveal does not expose the next board.

Pass commands also carry a snapshot revision. A repeated pass within the same turn succeeds without changing scores, revision, or room lifetime; a delayed pass from an earlier turn is rejected. This state-setting operation does not need a separate command-result cache. Protocol version 3 requires this payload: deploy the frontend and game server together, and reload older clients to reconnect.

## Host advancement

Both “Next hint” and “Finish the game” require every eligible picker on the current board to finish. The server checks current state before changing the turn or phase, and snapshots drive the host's disabled control and waiting message. A stale client or a repeated advance cannot skip an active guessing turn. Rejected advancement does not change the board, scores, player turns, revision, or room activity time.

Passing, selecting a civilian/assassin, or explicitly leaving completes that picker's turn. Claiming the last target completes all pickers, so no extra passes are required. The clue-giver, spectators, and inactive seats do not block advancement; a host who is also a picker must finish along with everyone else. Completion enables the host action without automatically advancing.

Temporary disconnects do not change membership or guessing eligibility and therefore continue to block advancement until the picker reconnects and finishes, or all targets are found. There is no timeout-based abandonment or host force-advance override. Explicit leave preserves its existing finish-turn behavior; rejoining does not reopen guessing on that board.

## Membership

Room membership is independent from a Socket.IO connection. Disconnecting does not remove a player. Explicitly leaving during a game preserves the historical seat and score; reconnecting with the same browser token restores it. A new identity joining after the lobby is assigned spectator participation and cannot submit hints, claim cards, or enter the player standings.

Explicitly leaving during guessing ends the picker's turn, like passing. Rejoining restores a finished, privately revealed view, never eligibility to guess again on that board. This reveals no more than the freely available pass action; transport disconnect alone does not finish the turn or reveal hidden roles.

### Guest identity security boundary

The browser persists a randomly generated 128-bit guest token in localStorage and sends it in the Socket.IO handshake. This is a bearer credential for room membership, including host actions; it is not a Clerk account credential. Production socket connections require HTTPS. Rooms and their membership state are in memory and disappear on expiry or server restart.

The token remains readable by same-origin JavaScript. XSS or a compromised third-party script could steal it and impersonate that guest in surviving rooms. HTTPS does not prevent this risk. Do not treat guest identity as suitable for sensitive account data or privileged non-game actions.

Moving to a server-issued HttpOnly cookie requires a coordinated session protocol and deployment design: the frontend and game server can be on different sites, and cookie delivery, cross-origin credentials, origin/CSRF protections, local development, and reconnect migration must be tested together. A same-origin gateway or another explicitly designed session boundary is future security work; the current localStorage model does not provide HttpOnly protection.
