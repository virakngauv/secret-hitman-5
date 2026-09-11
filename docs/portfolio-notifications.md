# Portfolio backend releases

Portfolio checks this repository's main-branch quality and browser CI once daily at 2:20 AM Pacific. It advances the backend pin through a portfolio release PR with required integration checks, then DigitalOcean deploys after merge.

For an immediate check, open [portfolio Actions](https://github.com/virakngauv/portfolio/actions), select **Reconcile upstream releases**, click **Run workflow**, choose **main**, and confirm. The receiver must be merged and enabled first. Only tested, forward revisions qualify.

This repository needs no notification job or portfolio App credentials. Keep the receiver private key only in portfolio; remove obsolete `PORTFOLIO_APP_PRIVATE_KEY` secrets and `PORTFOLIO_APP_ID` variables here.

See [the portfolio release guide](https://github.com/virakngauv/portfolio/blob/main/docs/automatic-releases.md) for setup and troubleshooting. Frontend deployment remains separate.

Posted by Codex acting on behalf of @virakngauv.
