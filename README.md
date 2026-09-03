# Secret Hitman 5

A one-round, host-driven multiplayer word game built with Next.js, React, TypeScript, and Socket.IO.

## Gameplay

1. The host creates a room and invites at least one other player.
2. Starting players each receive a private board of 12 words. Three civilians and the assassin are randomly locked for the lifetime of the board; the other eight words are editable.
3. Every participant writes a hint and selects 1–5 editable words it should describe. Selected words become targets and every other non-assassin word becomes a civilian. New players may join during this phase; each receives a private 12-word board and must complete the same hint and editable-word selection before guessing can begin. Explicitly leaving removes that participant's current board and clue; rejoining before guessing creates a fresh board and requires a new submission.
4. Each submitted hint and number appears immediately to everyone in the room. Players can still unlock and revise their own private board, while the host may reject another submitted hint at any time and give that player a fresh board. When every hint is locked, the host starts guessing and manually advances each player’s clue-giver turn.
5. A target awards 3 points to both picker and clue-giver. A civilian removes 1 point from both and ends only that picker’s turn. The first assassin removes 5 points from its picker and the clue-giver, completes that clue-giver’s board for everyone, and reveals every role and claimant. The host then advances to the next participant’s hint, so an assassin does not end the overall round.
6. After every participant gives one hint, the single round ends and final standings are revealed.

There are no gameplay timers. New identities join as participants while clue creation remains open, then enter in read-only spectator mode after guessing starts. Reconnecting browsers recover their original seat from a private local token while the in-memory room still exists.

## Architecture

- The Next.js App Router frontend runs independently from the Socket.IO game server.
- One Node.js process owns all active rooms in memory and emits complete, personalized snapshots after every change.
- The server is authoritative for roles, hidden card types, hint targets, scoring, spectators, and host-only transitions.
- Rooms are ephemeral and expire after two hours without a meaningful game command.
- A room retains at most 1,024 identities across member history and removal fingerprints. Once full, new identities must use a new room; existing game seats can reconnect, and removed identities remain blocked until the room expires.
- Socket IDs never identify players; a private 128-bit browser token supports reconnects.

## Local development

Requirements: Node.js 22+ and pnpm 11.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

This starts:

- Next.js at `http://<lan-ip>:3000` — the printed Network URL is your LAN IP,
  which other devices on a trusted local network can open directly
  (`http://<hostname>.local:3000` also works)
- Socket.IO at `http://<lan-ip>:3200`

Both servers fall back to `127.0.0.1` when no LAN address exists. Set `HOST`
to override the address both bind to — `HOST=127.0.0.1 pnpm dev` keeps
everything on loopback.

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

Set `NEXT_PUBLIC_GAME_SERVER_URL` to an HTTPS endpoint on the frontend and set `ALLOWED_ORIGINS` to the frontend origin on the game server. Production clients refuse insecure socket endpoints; HTTP is available only in development for local/LAN testing.

The App Platform example opts into `TRUST_DIGITALOCEAN_PROXY=true`, using the provider's [`do-connecting-ip` header](https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/) rather than trusting a private address range. Enable this only behind that managed ingress, which sets the header; never use it on a directly reachable server. Missing or invalid headers fall back to the peer IP for conservative rate limiting.
