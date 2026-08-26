# Local tooling already available

Read this before telling the user how to install something, or before assuming
a tool isn't there. This file is the record of what's already set up on this
Mac's shell — check here first.

## Node

A real Node is on `PATH` already (not just the scratch-fetch CLAUDE.md
describes for quick syntax checks) — `node -v` returns a recent version
without any setup. `npx` works directly, no scratch-directory dance needed.

Confirmed 2026-08-26: `node -v` → v26.7.0, `npx` on PATH at
`/opt/homebrew/bin/npx`. A separate `~/node-scratch/node-v24.18.0-darwin-arm64`
also exists from an earlier session — either works, no need to re-fetch.

## Firebase CLI

Available via `npx firebase-tools` — no global install, already logged in as
`eddie.cy.chou@gmail.com`. Deploy Firestore rules after any `firestore.rules`
change:

```bash
cd ~/Developer/costing-tool   # firebase.json lives here — must run from repo root
npx firebase-tools deploy --only firestore:rules --project crystocraft-costing
```

A successful deploy that changed nothing prints "latest version of
firestore.rules already up to date, skipping upload" — that's not an error,
it means the live rules already matched.

Logged in account can see two projects: `crystocraft-costing` (this app,
default per `.firebaserc`) and `crystocraft-expenses` (separate project, not
otherwise referenced from this repo — don't assume it's related unless the
user brings it up).

## Fly.io CLI

`flyctl` (also aliased `fly`) is a real installed binary at `~/.fly/bin/`, not
on `PATH` by default — add it per-session:

```bash
export PATH="$HOME/.fly/bin:$PATH"
```

Logged in as `eddie.cy.chou@gmail.com`. Runs the customizer render service —
`render-service/fly.toml` deploys to the Fly app `crystocraft-customizer-render`
(confirmed live via `flyctl apps list`, last deploy 2026-08-10). Deploy with:

```bash
cd ~/Developer/costing-tool/render-service
flyctl deploy
```

## GitHub

No `gh` CLI installed — but plain `git push`/`git pull` against
`github.com/eddiecychou/crystocraft-costing-tool` already works with no
prompt, via a credential cached in the macOS keychain (`osxkeychain` helper).
Don't suggest installing `gh` or setting up a token; just use `git` directly.

## Netlify

**Not logged in** via CLI (`npx netlify-cli status` → "Not logged in") — don't
assume `netlify deploy` or `netlify env` commands will work without first
walking through `netlify login`. Deploys happen automatically instead: this
repo is linked to a specific Netlify site (`.netlify/state.json`, gitignored,
siteId `4a234708-a213-477f-91a5-97cdc939c1db`) via its GitHub integration — a
`git push` to `main` is what triggers the deploy, not a CLI command. This
matches CLAUDE.md's "pushing deploys via Netlify" convention; no separate
Netlify action is normally needed.

## Updating this file

When a new tool gets set up in a session (installed, logged in, confirmed
working), add it here rather than re-discovering it next time. Keep entries
short: what the tool is, how to invoke it, and any gotcha (wrong directory,
needs login, etc). This file is checked into git so it survives across the
two-Mac sync same as everything else in CLAUDE.md's reading list.
