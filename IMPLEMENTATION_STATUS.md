# Milestone 1 implementation report — 19 November 2026

## Implemented in source
- React + TypeScript responsive Valoria lobby with private invite codes and 10/15/30-day selection.
- Server-validated anonymous Auth and room lifecycle: create, join, host start, lobby leave, host transfer.
- Persistent room-wide text chat with server-side validation, 500-character limit, 5 messages/10 seconds rate limit, nonce idempotency, timestamp, sender identity, full-screen/compact/collapsed UI.
- Member-isolated rooms/chat and protected private Realtime subscriptions using Supabase RLS.
- Browser session rehydration, member reloading, message refresh and fallback polling.
- Basic visual preview (`preview.html`) with **clearly fictional sample** chat/players; not connected to Supabase.

## Checked in creation environment
- Static security/source invariant checks: 16 passed.
- Syntax-only TypeScript transpilation: run `node tests/check_syntax.cjs` (not full type checking).
- External npm registry unavailable, so `npm install`, `npm run typecheck`, and actual React bundle were **not performed**.
- No Supabase project credentials or execution access was provided in this session; migration was **not executed** and room/chat RLS was **not integration tested**.
- Screenshot tool/browser navigation to local preview blocked by execution sandbox; no real-device layout check.

## Not yet done
- Connect a Supabase test project and run SQL migration; verify policies with multiple guest accounts.
- Install npm dependencies; run full TypeScript typecheck and production build; fix any integration errors.
- Deploy the frontend on GitHub Pages and perform actual UK/Syria iPhone tests.
- Add messages pagination beyond latest 100 in the UI; older history remains in database.
- Implement approved 10-minute disconnect abandonment vote during real turn engine milestones.
- Add full game/day/trading flow in future milestones. The 'in-game' screen is explicitly a foundation placeholder.

## Risk note
Do not rely on source-level tests as a substitute for Supabase RLS integration. Test non-member access and simultaneous joining/send races using independent authenticated users before using with real players.
