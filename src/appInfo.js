// Name and version of the internal admin app, in one place.
//
// Renamed from "Product Manager" (2026-07-19) — that stopped being true around
// the time shipping, production, inventory and the ERP work landed. This is
// where the operations actually happen, not a window onto something else.
//
// Note this is the ADMIN shell only. The browser tab stays "Crystocraft
// Customer Portal": the same deployment also serves the customer storefront at
// portal.crystocraft.com, and that title and its OG tags are customer-facing.
export const APP_NAME = 'Operation Center'

// Shown small in the sidebar so it's obvious which build is live.
//
// Deliberately the SAME number as the development cycle in PROJECT-PLAN.md, so
// "which version are you on?" has one answer whether it's asked of the team or
// of the docs. Bump it when a cycle closes, not on every commit.
export const APP_VERSION = 'V8.11'

// Injected by Vite at build time (see vite.config.js). The version alone can't
// tell you whether a deploy actually went out — several changes this cycle
// shipped and were verified by eye on the live site, and "is my change live
// yet?" was a real question. The build time answers it.
export const BUILD_TIME =
  typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''

// "V1.5 · 19 Jul 14:32" — short enough to sit under the logo.
export function versionLabel() {
  if (!BUILD_TIME) return APP_VERSION
  const d = new Date(BUILD_TIME)
  if (Number.isNaN(d.getTime())) return APP_VERSION
  const stamp = d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  return `${APP_VERSION} · ${stamp}`
}
