# Project Instructions

- Use pnpm for dependency management.
- Keep the Next.js App Router and TypeScript strict mode enabled.
- Add reusable UI primitives under `components/ui` and application components under `components`.
- Treat Clerk and PostHog as optional in local development until their environment variables are set.
- Run lint, typecheck, unit tests, and a production build before handing off meaningful changes.
- Create or identify a tracking issue before opening a pull request, and include `Closes #<issue-number>` in the pull request description so GitHub links and closes the issue on merge.

## Multiplayer Browser Testing

- For exploratory two-player browser testing, use the Codex in-app Browser as player one and connected Chrome Computer Use as player two.
- Create and join the room through both real user interfaces. Do not use two tabs in the same browser because they share player storage.
- Verify that each browser identifies a different local player before describing the test as two-player.
- Test shared board state, scoring from both players, player-specific cooldowns, and reconnect behavior from both browsers.
- If Chrome Computer Use is unavailable, report the exploratory two-player test as blocked. Use two isolated Playwright browser contexts as the automated fallback.
- Never describe a backend-injected participant as a complete two-player UI test. Label it as a single-player UI test with a simulated participant.
