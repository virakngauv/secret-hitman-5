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

Requirements: Node.js 22.9.0+ and pnpm 11.

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
# Also verify enabled pack UI (managed test server, no Clerk credentials):
PW_WORD_PACKS=1 pnpm exec playwright test e2e/word-packs.spec.ts
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

Clerk Next.js 7.9.1, backend 3.17.1, and UI 1.32.2 are pinned for this integration.
The provider imports the installed UI implementation, and `next.config.ts` pins
the browser ClerkJS runtime to 6.31.0 through the SDK-supported
`NEXT_PUBLIC_CLERK_JS_VERSION` setting. Upgrade these together and repeat configured
Clerk account/billing verification. Use a Clerk
**development** instance with individual-user Billing. Create a user Plan with
Features `pack_movies_v1` and `pack_travel_v1`; do not enable trials or complimentary
offers. The backend uses fresh subscription items and their millisecond periods,
not the parent subscription status or client claims. Canceled items retain access
until period end; past-due items cannot start new premium rounds. This conservative
development policy needs approval before launch.

Set both Clerk keys, `CLERK_ISSUER`, and `CLERK_AUTHORIZED_PARTIES` in **both** Next.js
and the standalone Node process. `pnpm dev` loads `.env.local` for both processes
and defaults the web hostname to `localhost`. Shell variables take precedence,
and a missing `.env.local` does not prevent startup. Standalone `pnpm dev:server`
and production commands still require exported variables or deployment configuration.
Use exact frontend origins and optionally `CLERK_AUDIENCE` if your tokens include a
configured audience. Partial configuration disables protected use. Never expose
`CLERK_SECRET_KEY` under a `NEXT_PUBLIC_` name.
When `ENABLE_WORD_PACKS=true`, Next.js requires a non-empty
`CLERK_AUTHORIZED_PARTIES` list. An absent or blank list fails closed with HTTP 503;
the deployment environment check rejects incomplete launch configuration. The
production game process also refuses to start with missing Clerk configuration.
When the flag is off, Clerk configuration is unused and cannot block Base play.
Lobby login and signup open separate tabs so OAuth cannot unload the game tab.

The root layout is dynamic: the server reads `ENABLE_WORD_PACKS` and the secret
key availability at request time, rather than baking these gates into static HTML.
The public Clerk publishable key and public game-server URL still need their
intended values at Next.js build time. The secret stays server-side. Set the same
release flag in **both** Next.js and the standalone game-server deployment, and
restart/redeploy both processes together when changing it. Do not set a public
browser environment variable as an independent release switch.

The example allowlist covers localhost development only. If opening the app at
a LAN address, custom hostname, or different port, add that exact frontend origin
to `CLERK_AUTHORIZED_PARTIES` in both processes. Next.js `allowedDevOrigins` only
permits development requests; it does not authorize Clerk sessions. Plain HTTP
LAN sockets cannot carry account tokens: use localhost or HTTPS for premium play.
Origin entries must have no trailing slash, path, query, fragment, or credentials.

Default Clerk session tokens have no audience claim. Leave `CLERK_AUDIENCE` unset
for those tokens. If customizing session tokens with an audience, configure the
same expected value; audience-bearing tokens are denied without that setting.
Token issue/not-before times permit five seconds of clock skew, while token expiry
and paid subscription period boundaries remain strict. Keep server clocks synchronized.

- `ENABLE_WORD_PACKS` is the single application release flag and defaults to false.
  Off is a dark deployment: no pack selector, Buy buttons, Clerk account controls,
  or shop is rendered; pricing/account/sign-in/sign-up routes and the access API
  return 404. Clerk middleware is bypassed. The game server advertises only Base
  and rejects premium selection/start requests regardless of client behavior.
- `ENABLE_WORD_PACKS=true` launches the complete feature: account integration,
  catalog, host selection, authorization, and Clerk purchase UI. Prices and offers
  come from Clerk. Configure and approve the target instance before enabling it.
- `/account` provides Clerk's account/subscription UI plus an access preview.
  It is protected when Clerk is configured. The lobby's Buy links open the shop
  in a modal, preserving the browser's game identity.
- Pack checkboxes are client-side state only, with a page-load access preview.
  Start game sends the complete selection; the server validates every pack and
  authorizes all paid access before starting. Any failure keeps everyone in the
  lobby and reports the failed pack and reason to the host. Reloading or returning
  to the lobby restores the room's last confirmed pack selection. Checkbox edits
  that have not been submitted with Start remain local to the mounted lobby.
- Each protected command gets a fresh session token in memory. Tokens do not enter
  local storage, guesses, logs, or analytics. A 4.5-second operation deadline and
  room revision checks prevent late authorization from committing a stale start.
  Premium tokens require HTTPS, except for loopback HTTP in local development;
  HTTP LAN play supports only Base. A pnpm patch to the pinned Clerk backend SDK
  aborts each outbound fetch after five seconds, including response-body reads.
  Responses are limited to 2 MiB: oversized declared lengths are rejected and
  streamed bytes are counted independently, including decompressed bodies.
  This applies to JWKS, session, and billing calls in both module formats; SDK
  retries remain bounded by their existing retry count. A process-wide limit of
  32 operations and per-room/per-preview guards retain capacity until the
  underlying request actually settles; anonymous token verification is capped
  below the shared budget so a verification burst cannot starve verified
  hosts' account lookups. Keep the patch and transport regression
  tests when upgrading Clerk; remove it only after verifying equivalent SDK support. Timeouts permit Base recovery
  but cannot spawn overlapping protected work for the same room/account.
  Browser token minting also has a 4.5-second deadline: controls recover on timeout,
  Base remains usable, and a late token cannot emit the expired command.
- All boards in an authorized round use the same fixed content version, including
  replacement boards and late hinting joins. Provider outages and subscription
  changes do not interrupt that round. Returning to the lobby preserves the
  confirmed selection; host succession resets it to Base. Each new premium round
  requires current host access.
- Rooms remain ephemeral and expire after two idle hours. Restarts discard rooms;
  later access checks read Clerk directly without a database, ledger, or webhooks.

Before live charges, the owner must approve recurring terms, intervals/prices,
exact catalog and Feature mapping, future pack inclusion, past-due policy,
content rights/public source availability, and a support/refund process. Verify
Clerk's current currency, geographic, tax/VAT, 3DS, and refund limitations. A gateway
refund must not be assumed to end Clerk subscription access. Do not add direct
Stripe Checkout, an app payment ledger, or billing webhooks as a workaround.

For a pre-launch deployment, leave `ENABLE_WORD_PACKS=false` in both processes.
Keep test/non-launch Clerk Plans non-public while testing. Plan visibility is a
separate provider-side safeguard, not another application flag. Review every
public Plan before enabling the release flag. `pnpm deploy:check-env` validates
launch configuration and reads all pages of user Plans when the feature is enabled.
It requires every public non-default user Plan to cover every enabled premium
pack's Feature slug from the deployed catalog and rejects Plans with free trials;
default/private Plans cannot satisfy this check. This matches the unfiltered
pricing table, where a buyer can choose any public Plan. This verifies availability,
not approval of prices or terms. Review the individual Plan descriptions and
included packs before approving offers. Disabled deployments do not contact Clerk.

After launch, **do not use the release flag merely to pause sales**: switching it
off also hides account management and denies new paid rounds for existing users.
To pause new offers while retaining paid hosting and subscription management,
leave the release flag on and make non-default user Plans non-public in Clerk.
Keep Billing, subscriptions, and Feature attachments intact. Verify `/pricing`,
the shop, `/account`, avatar billing, and any hosted account UI with both a free
user and an existing paid subscriber. Provider Plan visibility is not a guarantee
that already-open checkouts are revoked; verify that procedure separately.
Do not add direct checkout links for private Plan IDs.
The launch check deliberately fails while all offers are private; do not make
Plans public just to pass it during a sales pause. Existing deployments can keep
serving subscribers with private Plans. A deployment during that pause requires
separate review of the deployment procedure, rather than treating the launch
check as successful.

Development release verification must exercise Clerk sign-in/account switching,
checkout cancel/failure/success and access refresh, cancellation through exact
expiry, renewal, past-due/recovery, revoked sessions, and provider outage with a
real development instance. Automated adapter tests do not replace these provider
flows. Deploy frontend and game server together for protocol version 16; old
clients are rejected with a reload instruction in the handshake error. Older
client UIs may show only a reconnect banner, so instruct existing players to
reload after the coordinated deployment. Rollback requires coordinated versions and loses
active rooms. Verify no premium pools or credentials appear in browser bundles,
public responses, or logs before enabling a paid catalog.

The lobby avatar has an explicit “Sign out and stay in room” action that ends
the Clerk session without navigation, retaining the independent anonymous game seat. Verify the actual configured Clerk avatar action beyond the
three-second leave grace period, then select/start Base. The Next.js middleware
and socket authorizer both use `CLERK_AUTHORIZED_PARTIES` as the token-origin
allowlist.
