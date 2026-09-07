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

Set `NEXT_PUBLIC_GAME_SERVER_URL` to an HTTPS endpoint on the frontend and set `ALLOWED_ORIGINS` to the frontend origin on the game server. Production clients refuse insecure socket endpoints; HTTP is available only in development for local/LAN testing.

The App Platform example opts into `TRUST_DIGITALOCEAN_PROXY=true`, using the provider's [`do-connecting-ip` header](https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/) rather than trusting a private address range. Enable this only behind that managed ingress, which sets the header; never use it on a directly reachable server. Missing or invalid headers fall back to the peer IP for conservative rate limiting.

### Predefined packs and Clerk Billing (development)

Base hosting and guest play require no account. The original Movies and Travel
packs are public development samples, not an approved commercial catalog. Their
full pools ship only with server code, but are readable in this public repository.
The catalog and socket snapshots expose descriptions and sampled boards, never
full pools. Do not put private content into this repository without a separate
content delivery decision.

Clerk Next.js 7.5.20 and backend 3.11.7 are pinned for this integration. Use a Clerk
**development** instance with individual-user Billing. Create a user Plan with
Features `pack_movies_v1` and `pack_travel_v1`; do not enable trials or complimentary
offers. The backend uses fresh subscription items and their millisecond periods,
not the parent subscription status or client claims. Canceled items retain access
until period end; past-due items cannot start new premium rounds. This conservative
development policy needs approval before launch.

Set both Clerk keys, `CLERK_ISSUER`, and `CLERK_AUTHORIZED_PARTIES` in **both** Next.js
and the standalone Node process. `tsx` does not load Next's `.env.local`; export
these variables in the process environment or configure the deployment environment.
Use exact frontend origins and optionally `CLERK_AUDIENCE` if your tokens include a
configured audience. Partial configuration disables protected use. Never expose
`CLERK_SECRET_KEY` under a `NEXT_PUBLIC_` name.

- `ENABLE_PREMIUM_PACKS=true` makes the sample packs available for authenticated
  selection and hosting. It defaults to false.
- `ENABLE_CLERK_CHECKOUT=true` enables Clerk's user PricingTable on `/pricing`.
  It defaults to false and is independent of hosting access. Prices come from
  Clerk; this repository defines no prices or offers.
- `/account` provides Clerk's account/subscription UI plus an access preview.
  It is protected when Clerk is configured. Pricing opens separately from the lobby
  so checkout cancellation or failure leaves the browser's game identity intact.
- Each protected command gets a fresh session token in memory. Tokens do not enter
  local storage, guesses, logs, or analytics. A 4.5-second operation deadline and
  room revision checks prevent late authorization from committing a stale start.
  Premium tokens require HTTPS, except for loopback HTTP in local development;
  HTTP LAN play supports only Base. The pinned Clerk SDK cannot cancel an in-flight
  request: a process-wide limit of 32 operations and per-room/per-preview guards
  retain capacity until underlying requests settle. Timeouts permit Base recovery
  but cannot spawn overlapping protected work for the same room/account.
- All boards in an authorized round use the same fixed content version, including
  replacement boards and late hinting joins. Provider outages and subscription
  changes do not interrupt that round. Returning to the lobby or host succession
  clears the selection to Base; each new premium round requires current host access.
- Rooms remain ephemeral and expire after two idle hours. Restarts discard rooms;
  later access checks read Clerk directly without a database, ledger, or webhooks.

Before live charges, the owner must approve recurring terms, intervals/prices,
exact catalog and Feature mapping, future pack inclusion, past-due policy,
content rights/public source availability, and a support/refund process. Verify
Clerk's current currency, geographic, tax/VAT, 3DS, and refund limitations. A gateway
refund must not be assumed to end Clerk subscription access. Do not add direct
Stripe Checkout, an app payment ledger, or billing webhooks as a workaround.

Development release verification must exercise Clerk sign-in/account switching,
checkout cancel/failure/success and access refresh, cancellation through exact
expiry, renewal, past-due/recovery, revoked sessions, and provider outage with a
real development instance. Automated adapter tests do not replace these provider
flows. Deploy frontend and game server together for protocol version 14; old
clients receive a reload message. Rollback requires coordinated versions and loses
active rooms. Verify no premium pools or credentials appear in browser bundles,
public responses, or logs before enabling a paid catalog.
