# Secret Hitman 5

A one-round, host-driven multiplayer word game built with Next.js, React, TypeScript, and Socket.IO.

## Gameplay

1. The host creates a room and invites at least one other player.
2. Starting players each receive a private board of 12 words. One randomly selected word is the frozen assassin.
3. Every player writes a hint and selects the non-assassin words it should describe. The number is generated from the selection count.
4. When every hint is locked, the host starts guessing and manually advances each player’s clue-giver turn.
5. Guessing a target awards one point to both the guesser and clue-giver. A civilian ends that player’s guessing for the hint. The assassin ends their guessing and removes one point from both players.
6. After every starting player gives one hint, the single round ends and final standings are revealed.

There are no gameplay timers. New identities may join after the game starts, but they enter in read-only spectator mode. Reconnecting browsers recover their original seat from a private local token while the in-memory room still exists.

## Architecture

- The Next.js App Router frontend runs independently from the Socket.IO game server.
- One Node.js process owns all active rooms in memory and emits complete, personalized snapshots after every change.
- The server is authoritative for roles, hidden card types, hint targets, scoring, spectators, and host-only transitions.
- Rooms are ephemeral and expire after two hours without a meaningful game command.
- Socket IDs never identify players; a private 128-bit browser token supports reconnects.

## Local development

Requirements: Node.js 22+ and pnpm 11.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

This starts:

- Next.js at `http://127.0.0.1:3000`
- Socket.IO at `http://127.0.0.1:3200`

To test on a trusted local network:

```bash
WEB_HOST=0.0.0.0 HOST=0.0.0.0 pnpm dev
```

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

The automated multiplayer tests use isolated browser contexts so each player receives a different local identity. The managed e2e stack uses ports 3125 and 3225 to avoid colliding with normal development.

## Production topology

The frontend can be deployed to Vercel. Run the game server as exactly one long-lived Node.js instance; horizontal scaling without a shared room adapter would split room state.

Set `NEXT_PUBLIC_GAME_SERVER_URL` on the frontend and set `ALLOWED_ORIGINS` to the frontend origin on the game server. Socket.IO will use WSS when the public server URL uses HTTPS.
