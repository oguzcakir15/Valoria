# Valoria Milestone 1 — GitHub Pages + Supabase

This package includes the original application, its original Supabase SQL migration and a GitHub Actions deployment workflow. The game has **not** been published or integration-tested against a real Supabase project.

## 1. Configure Supabase first

Use a **test Supabase project**. In Authentication → Providers, enable **Anonymous sign-ins**. Review and run `supabase/migrations/202611190001_milestone1.sql` in SQL Editor exactly once, checking for errors. The migration defines the room/member/chat schema and policies. Confirm RLS and Realtime configuration; use CAPTCHA and rate limits for public anonymous sign-ins. Don't share database passwords or `service_role`/`sb_secret_` keys.

From your Supabase project obtain **Project URL** (https://...supabase.co) and the **publishable** browser key (`sb_publishable_...`). These are public frontend configuration, unlike secret keys.

## 2. Upload this package to GitHub

Create a repository (for example `valoria`). Upload **the contents of this ZIP**, not the ZIP file itself: `package.json`, `src`, `supabase`, `.github/workflows/deploy.yml`, etc. Ensure `.github` is included. The project files must be at the repository ROOT, not nested in a `valoria_milestone1` directory. Prefer git CLI or GitHub Desktop if the GitHub website misses hidden files. Use branch `main`.

## 3. Configure GitHub repository variables

Open **Settings → Secrets and variables → Actions → Variables → New repository variable**, and add:

- `VITE_SUPABASE_URL` = the project's HTTPS URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` = the Supabase **publishable** key

The frontend reads exactly these two names (`src/client.ts`). Never use the `service_role` key. **Values are compiled into the public website**, so only browser-safe values should be used.

## 4. Enable GitHub Pages

In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. In **Actions**, run "Deploy Valoria to GitHub Pages" if the initial push did not trigger it. GitHub Actions installs dependencies, runs source security checks, builds Vite with the correct base path, then deploys `dist/` to Pages.

The workflow supports a missing lockfile on its initial run by running `npm install` in CI. For reproducible builds, generate and commit `package-lock.json` from a successful `npm install` as soon as possible; future builds use `npm ci` automatically.

Wait for the GitHub Actions **deploy** job to succeed; use its environment URL. A project repository commonly has the format `https://USERNAME.github.io/REPOSITORY/`, but do not assume it's live until deployment succeeds.

## 5. Live checks on separate phones

Create a lobby on phone A, join with the code on phone B, exchange messages, reload each browser, test host-only start (with two participants) and room capacity of four, and test chat in the game placeholder. Test a nonmember cannot read private data and that unauthorized join attempts are rejected. Anonymous browser sessions are not portable across devices. This milestone does **not** include economy gameplay, day turns or real end-day mechanics.

## Notes

- The actual project was packaged from the supplied Milestone 1 source ZIP. The original source files and SQL migration were left unchanged.
- Local npm install/typecheck/build could not be verified in this environment because the npm registry was unreachable. GitHub Actions must perform the real build; check its logs and resolve any actual build errors before considering this deployed.
- `vite.config.ts` sets `base: './'`; the GitHub workflow overrides it with the repository-specific base using `vite build --base`.
- GitHub Pages is public by default; restrict game access using Supabase authentication/RLS, not obscurity of the website URL.
