# Valoria — Milestone 1: Multiplayer Foundation

**Current status:** Working source code and SQL migration prepared. **Not yet deployed** or verified against a real Supabase project. Frontend dependencies could not be installed in the creation environment because the npm registry was unreachable. This is not a claim of a successful two-iPhone test.

## Included
- Mobile-first, landscape-aware medieval lobby and stylised kingdom placeholder.
- Anonymous Supabase Auth, nickname, room create/join by 10-character invitation, 2–4-player limit.
- Server-validated host-only start, room host transfer on lobby departure.
- One persistent room chat across lobby → in-game, collapsible/expanded, server history, unread counters, mute (visual notification preference), 500-character cap and server rate limits.
- Supabase RLS for room/member/message records; all mutations via authenticated, validated security-definer RPCs.
- Private member-authorised realtime channel + member-filtered Postgres Changes with 15-second reconciliation polling as fallback.
- Session persistence for same-browser reconnection (requires retained Supabase Auth session and storage).
- Dedicated blueprint for security and test cases.

## Not included yet
Market, currency, order clearing, Day/End Day, a finished results screen, chat DMs, production password accounts, recovery across devices, Treasure Hunt, AI takeover, wider anti-abuse and end-to-end real-device testing.

## Setup (in your test Supabase project)
1. Create a separate *test* Supabase project, or carefully plan a safe migration for your existing one. **Never share service-role or database credentials in a chat or frontend file.**
2. In **Authentication → Providers**, enable **Anonymous Sign-ins**. On a public deployment, configure CAPTCHA and auth abuse protections.
3. In **SQL Editor**, run `supabase/migrations/202611190001_milestone1.sql` once. Check for errors; do not assume partial migrations succeeded.
4. In **Project Settings → API**, copy only the project URL and the **publishable** key to a `.env` file, using `.env.example` as a template.
5. Install dependencies and run the app:

   ```bash
   npm install
   npm run typecheck
   npm run dev
   ```

6. Open the Vite URL in two distinct browser sessions or devices. The first player creates a room, the second joins using the invite code. Confirm both see the participant list and chat in real time.
7. For a static production test: `npm run build` then publish `dist/` on GitHub Pages, set the correct deployment base path if the site lives in a subdirectory; default `base: './'` works for relative asset paths. Configure the Supabase Auth site/redirect settings for the site's URL if later adding OAuth. Current anonymous sign-in needs no redirect.

### Supabase publication / Realtime configuration
The migration adds the 3 Valoria tables to `supabase_realtime`, with RLS per-member and a private channel topic policy on `realtime.messages`. Some projects have the table already in the publication: if that migration block reports duplicate-object errors, inspect publication membership first; do not drop existing publication state. If private subscriptions fail, confirm Realtime is enabled in the dashboard and inspect the `realtime.messages` SELECT policy.

## Test checklist
1. Two fresh browser identities create/join successfully; a third/fourth can join; fifth is rejected.
2. Guest users cannot select another room's records or subscribe to another room's private channel.
3. Guessing another room code must not expose records without successfully joining the room. Treat a leaked invitation code as an invitation; only share with trusted players.
4. Non-host cannot start; host cannot start alone; only 10, 15 or 30 days accepted.
5. Both players send messages, see the same history, leave/reload and return without duplicates.
6. Try empty, 501-character messages, non-member messages, repeated sends, and five-message burst rate limiting.
7. Test in portrait then landscape (landscape prioritised); open keyboard; expand and collapse chat.
8. Refresh each iPhone, background the app, toggle connectivity off/on; verify history restores and membership remains.
9. Host leaves lobby with 2+ players; next member becomes host; the last player leaving deletes the empty room.
10. Verify the in-game view is a **Milestone 1 placeholder**, not functional trading or day settlement.

## Threat model and limitations
- An invitation code grants access to join a *lobby*; it is not an account-recovery credential. A room code is 40 random bits; treat it as confidential. Security depends on auth IDs and RLS rather than nicknames.
- Anonymous sessions can be lost when browser storage is cleared, during private browsing or when changing devices. Cross-device recovery is a later feature.
- The browser publishes only its public Supabase key. Never put a `service_role` key in a browser or repository.
- The realtime event channel is used as a **notification transport**; all displayed messages are fetched from authorised DB records. Arbitrary broadcasts are not treated as proof of messages.
- A malicious authenticated member could message other authorised members or spam up to the server rate limit; content reporting/moderation and server-side block lists remain later security work.
- Data retention and room cleanup are not automated in this milestone; a future job should purge expired test rooms and chat after a defined lifecycle.
- The approved 10-minute disconnect/abandon vote system will be implemented alongside the actual turn loop. It is **not falsely simulated here**.
- **If using public guest signup at scale, add CAPTCHA and review rate limits and costs before deployment.**

## Development note
React StrictMode is deliberately not enabled in this first scaffold while the anonymous guest-session bootstrap is being established. A production-ready identity bootstrap should use a single-flight session initializer before StrictMode is reintroduced.

## Architecture
- React + TypeScript + Vite static frontend.
- Supabase Auth anonymous players, Postgres data, member-scoped RLS, RPC room/chat commands.
- Supabase Realtime private subscription for Postgres change notifications.
- Later: isolated trusted TypeScript economic engine, tested against the existing Python simulator before real gameplay.

## Design references
All approved visuals remain directionally binding. No extra commodities, rival private inventory or UI-only economic rules have been implemented. Milestone 1 only creates the lobby, map placeholder and continuous chat.
