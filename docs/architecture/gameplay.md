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
