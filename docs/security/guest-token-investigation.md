# Guest token storage and replay investigation

- Issue: [#3](https://github.com/virakngauv/secret-hitman-5/issues/3)
- Baseline reviewed: `9ae74956b4d76321898d086cd1c2e59b7d60d16f`
- Current implementation reviewed: `494adab3c75fd3ae8599374c49e52893e737ad00`

## Conclusion

Possession of a guest token and a surviving room code is sufficient to act as
that guest. A copied host token restores the host identity, exposes the host's
private clue-building board, and authorizes host-only commands. This is the
intended reconnect mechanism and a demonstrated replay capability, not evidence
that the token can currently be stolen remotely.

No application XSS sink was found in the reviewed source. The realistic theft
prerequisites are therefore same-origin script execution introduced by a future
XSS defect, a compromised client dependency or integration, a malicious browser
extension, or local access to the browser profile. The configured Clerk and
PostHog client integrations execute in the application origin when enabled, so
their compromise belongs in the threat model even though no compromise was
found.

The impact is **moderate**: an attacker can read private game state and perform
every game command available to the victim, including host transitions and
player removal. The current likelihood is **low** because tokens have 128 bits
of random entropy, cannot be enumerated through the protocol, production
clients require TLS, and no script-injection path was identified. For the
current anonymous, ephemeral game, the overall risk is **low to moderate**. The
same design would be unacceptable for account data, purchases, durable rooms,
or other sensitive privileges.

## Reproduction

`server/protocol.test.ts` contains an isolated Socket.IO scenario named
`demonstrates the copied guest-token replay boundary`. It uses only synthetic
players and performs these steps:

1. A host creates a room and a second token joins it.
2. A separate socket connects with a copy of the host token while the original
   host socket remains connected.
3. The copied socket resumes the host identity and starts the game.
4. The copied socket receives the host's private board, submits the host's hint,
   and performs the host-only transition into guessing.

A different random token receives no member snapshot and cannot run the same
host command. This distinguishes bearer-token possession from guessing a room
code alone.

## Credential lifecycle

| Stage              | Observed behavior                                                                                                                                                                                                       | Security consequence                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Creation           | The browser uses `crypto.getRandomValues` to generate 16 random bytes and encodes them as 32 lowercase hexadecimal characters.                                                                                          | Online guessing is impractical if browser randomness is sound.                                                                                   |
| Browser storage    | One token is stored under `secret-hitman-5:client-token` in `localStorage`.                                                                                                                                             | It persists across reloads, tabs, browser restarts, and every room on that web origin; any same-origin script can read it.                       |
| Transmission       | The token is sent as Socket.IO handshake authentication with the protocol version. Production clients refuse a non-HTTPS game-server URL.                                                                               | TLS protects it in transit from passive network observers. It is still a bearer credential after delivery.                                       |
| Server storage     | The raw token is retained in each connected socket, active room member record, command-result cache key, and rate-limit key. Removed-member deny entries use SHA-256 fingerprints. Tokens are not intentionally logged. | A game-server memory disclosure exposes active credentials. Hashing only the removal deny set does not make the live room token non-reusable.    |
| Reconnect and tabs | Any number of sockets presenting the same token resolve to the same member. There is no socket takeover or proof-of-possession step beyond the token.                                                                   | A replay can coexist with the legitimate player and receives the same personalized snapshots.                                                    |
| Browser reset      | Clearing or replacing browser storage creates a new identity.                                                                                                                                                           | This does not revoke the old token; a copy remains valid for surviving memberships. The player can also lose access to their old seat.           |
| Explicit leave     | Leaving a lobby deletes that room member. Leaving an active game retains the historical seat so the same token can return.                                                                                              | Active-game leave is not credential revocation. The token remains usable for that room.                                                          |
| Host removal       | The room fingerprints the removed token and rejects future join/resume attempts for that room.                                                                                                                          | This is effective room-local invalidation, including every socket sharing the token. It does not rotate the browser token or affect other rooms. |
| Room expiry        | Rooms expire after the configured inactivity window; an empty lobby is deleted.                                                                                                                                         | The token no longer grants access to deleted room state but remains the browser identity for other or future rooms.                              |
| Server restart     | All rooms and member records are in process memory. A restart clears them.                                                                                                                                              | Replays cannot restore vanished rooms; the unchanged browser token can create or join new rooms.                                                 |

There is no central token registry, expiry timestamp, rotation protocol, device
binding, or global revocation endpoint. A room code is also required because the
protocol does not enumerate memberships, but room codes are invitations rather
than secrets and are visible in URLs and QR codes.

## Affected capabilities

With a victim token and room code, a replay receives the victim's name, role,
participation, roster view, score, readiness state, and personalized snapshot.
For a starting player that includes the private clue-building board and, where
game rules allow it, private revealed roles. Commands are authorized exactly as
for the victim:

- a host replay can start the game, start guessing, advance turns, remove
  players in allowed phases, and leave the room;
- a player replay can submit their hint, claim cards, pass, and leave;
- a spectator replay remains limited to spectator capabilities.

The token does not authenticate a Clerk account and does not grant access to
Clerk credentials, PostHog data, server environment variables, or rooms whose
codes and surviving memberships are unknown.

## Existing safeguards and residual gaps

- Strong random generation prevents practical token guessing.
- Production clients fail closed rather than transmitting the token over HTTP.
- The game server restricts browser origins and validates every command's
  phase, role, payload, and room membership.
- Rooms are ephemeral, and sensitive account or purchase data is not attached
  to guest identities.
- Token values are absent from structured connection and command-failure logs;
  removed-member history stores only fingerprints.

Origin checks stop an unapproved browser origin from opening a normal socket,
but they do not stop same-origin malicious code and are not proof of user
intent. Non-browser clients can also omit `Origin`, so the bearer credential
remains the actual authorization boundary. TLS, payload validation, and rate
limits similarly limit other attacks without preventing replay of a stolen
credential.

The source audit found no `dangerouslySetInnerHTML`, direct `innerHTML`,
`eval`, dynamic script tag, or user-controlled URL-to-script path. React's
normal text rendering is used for names and hints. This lowers present
likelihood but is not a durable guarantee against future code or supply-chain
changes.

## Options

### 1. Retain the bounded guest credential for the current game

Keep the existing protocol while explicitly limiting guest identity to
ephemeral gameplay. Continue dependency review, add a restrictive Content
Security Policy as a separately tested hardening ticket, and never attach
account, payment, or durable private data to this token.

- **Benefit:** preserves anonymous play, separate frontend/game-server hosting,
  LAN development, tab sharing, and reconnect behavior.
- **Cost:** a future same-origin compromise can still steal and replay the
  token; CSP reduces injection paths but does not make `localStorage` secret
  from allowed scripts.

### 2. Store a separate token per room

Issue room-scoped credentials and retain a browser mapping from room code to
token.

- **Benefit:** reduces cross-room blast radius and allows room-local rotation.
- **Cost:** same-origin code can still steal every stored credential; creation,
  invitation, storage clearing, tab synchronization, room return, and migration
  all become more complex. It does not solve the core XSS exposure.

### 3. Use a same-origin gateway with an HttpOnly session cookie

Put browser session issuance and Socket.IO access behind the frontend origin or
a backend-for-frontend. Use a host-only `Secure`, `HttpOnly`, appropriately
`SameSite` cookie, explicit expiry/rotation/revocation, strict origin checks,
and CSRF protection for state-changing requests.

- **Benefit:** injected JavaScript cannot directly read and exfiltrate the
  credential, and the server gains a lifecycle it can revoke.
- **Cost:** requires a durable session store or signed rotating session design,
  gateway routing, reconnect migration, deployment changes, and local/LAN
  behavior. HttpOnly limits theft but same-origin malicious code can still send
  authorized commands while it is executing.

### 4. Send an HttpOnly cookie directly to a separate-site game server

Use credentialed Socket.IO requests and a cross-site cookie.

- **Benefit:** avoids storing the bearer value in JavaScript.
- **Cost:** `SameSite=None` requires `Secure`; credentialed CORS cannot use a
  wildcard origin; third-party-cookie policies can block or partition delivery;
  and explicit CSRF/origin defenses are mandatory. This is the most fragile
  option for the current Vercel plus independently hosted game-server topology.

Clerk sign-in alone is not a substitute for a game-session migration. It would
remove anonymous access if required, and same-origin hostile code could still
act through an authenticated client even when it cannot read an HttpOnly token.

## Recommendation and decision boundary

**Recommend option 1 for the current product:** accept and document the bounded
risk for anonymous, in-memory rooms, with CSP/dependency hardening tracked
separately. Do not implement a cookie migration solely for this game's current
assets.

An owner can explicitly accept that boundary for the current product or request
a separate session-migration design before accepting the investigation. In
either case, reopen the decision and prefer option 3 before any of the following
ships:

- guest identity becomes linked to Clerk accounts, custom packs, purchases, or
  other durable data;
- rooms or host authority persist beyond the current in-memory expiration
  boundary;
- a remotely exploitable same-origin script-injection path is found;
- product requirements add a user-visible sign-out/revoke-devices guarantee.

Closing this investigation records the evidence and recommendation; it does not
by itself accept the risk. If the owner accepts option 1, that acceptance applies
only to the present bounded gameplay model, not to those future capabilities. A
cookie migration should be a separate design and implementation issue with
deployment, CSRF, migration, and multi-browser acceptance tests.

## References

- [OWASP HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [MDN `Set-Cookie` reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
