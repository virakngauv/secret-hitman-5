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
- During guessing, only the clue-giver sees every card type. Guessers and spectators see target/civilian types after a claim.
- An assassin remains hidden from other guessers after it is selected, allowing each guesser to independently risk it.
- At the end of the game, the final board is fully revealed to everyone in the room.

## Membership

Room membership is independent from a Socket.IO connection. Disconnecting does not remove a player. Explicitly leaving during a game preserves the historical seat and score; reconnecting with the same browser token restores it. A new identity joining after the lobby is assigned spectator participation and cannot submit hints, claim cards, or enter the player standings.

### Guest identity security boundary

The browser persists a randomly generated 128-bit guest token in localStorage and sends it in the Socket.IO handshake. This is a bearer credential for room membership, including host actions; it is not a Clerk account credential. Production socket connections require HTTPS. Rooms and their membership state are in memory and disappear on expiry or server restart.

The token remains readable by same-origin JavaScript. XSS or a compromised third-party script could steal it and impersonate that guest in surviving rooms. HTTPS does not prevent this risk. Do not treat guest identity as suitable for sensitive account data or privileged non-game actions.

Moving to a server-issued HttpOnly cookie requires a coordinated session protocol and deployment design: the frontend and game server can be on different sites, and cookie delivery, cross-origin credentials, origin/CSRF protections, local development, and reconnect migration must be tested together. A same-origin gateway or another explicitly designed session boundary is future security work; the current localStorage model does not provide HttpOnly protection.
