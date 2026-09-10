# Portfolio release notifications

After a push to main passes both quality and end-to-end CI, the Notify portfolio job sends an upstream-ready repository_dispatch event to virakngauv/portfolio. The payload contains this repository's name and the exact tested commit SHA. Pull requests and manual CI runs do not dispatch. A failed or cancelled prerequisite prevents notification.

Before merging this integration:

1. Install a release GitHub App on virakngauv/portfolio with Contents: read/write. This sender does not require Pull requests permission.
2. In this source repository's Settings → Secrets and variables → Actions, add the variable PORTFOLIO_APP_ID and secret PORTFOLIO_APP_PRIVATE_KEY. Use the App ID and its PEM private key, not a personal account token. Do not commit the key.
3. Deploy portfolio's upstream-ready receiver to its default branch. It must validate the repository and SHA, handle duplicate/out-of-order events, update the pinned gitlink through a tested PR, and manage release eligibility.

The job generates a short-lived installation token scoped to portfolio and Contents: write. Missing credentials fail visibly. A successful dispatch only means GitHub accepted the event; it does not mean portfolio updated or production deployed. Without a receiver, dispatch has no release effect.

Validate after merge by checking the notification job and the matching portfolio receiver run for the same SHA. Do not send a production notification just to test workflow syntax. GitHub App setup, the receiving workflow, auto-merge rules, and DigitalOcean deployment configuration are separate from this sender.

Posted by Codex acting on behalf of @virakngauv.
