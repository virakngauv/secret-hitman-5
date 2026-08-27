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
  └─ host advances every turn manually
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

## Membership

Room membership is independent from a Socket.IO connection. Disconnecting does not remove a player. Explicitly leaving during a game preserves the historical seat and score; reconnecting with the same browser token restores it. A new identity joining after the lobby is assigned spectator participation and cannot submit hints, claim cards, or enter the player standings.

### Guest identity security boundary

The browser persists a randomly generated 128-bit guest token in localStorage and sends it in the Socket.IO handshake. This is a bearer credential for room membership, including host actions; it is not a Clerk account credential. Production socket connections require HTTPS. Rooms and their membership state are in memory and disappear on expiry or server restart.

The token remains readable by same-origin JavaScript. XSS or a compromised third-party script could steal it and impersonate that guest in surviving rooms. HTTPS does not prevent this risk. Do not treat guest identity as suitable for sensitive account data or privileged non-game actions.

Moving to a server-issued HttpOnly cookie requires a coordinated session protocol and deployment design: the frontend and game server can be on different sites, and cookie delivery, cross-origin credentials, origin/CSRF protections, local development, and reconnect migration must be tested together. A same-origin gateway or another explicitly designed session boundary is future security work; the current localStorage model does not provide HttpOnly protection.
