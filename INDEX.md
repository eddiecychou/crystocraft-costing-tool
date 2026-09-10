# Operation Center — Master Index (moved)

**This index has moved into the skill system at [`docs/skills/`](docs/skills/).**
It is now one system, not two.

Start with **[`docs/skills/SKILL.md`](docs/skills/SKILL.md)** — the master index
and feature-area router (the "which files does feature X touch?" table that used
to live here, in its §5).

Where the rest of this file's content went:

| Was here | Now in |
|---|---|
| Feature-area router (pages ↔ logic ↔ edge fns ↔ collections) | [`docs/skills/SKILL.md`](docs/skills/SKILL.md) §5 |
| Document set / source-of-truth index | [`docs/skills/SKILL.md`](docs/skills/SKILL.md) §3 |
| Cross-cutting systems (snapshots, thread-merge, counters, FX, stale chunks) | [`docs/skills/ARCHITECTURE-RULES.md`](docs/skills/ARCHITECTURE-RULES.md) §5–6 |
| Verify & deploy playbook | [`docs/skills/ARCHITECTURE-RULES.md`](docs/skills/ARCHITECTURE-RULES.md) §7 |
| "Mistakes already made here" | [`docs/skills/LESSONS-LEARNED.md`](docs/skills/LESSONS-LEARNED.md) |
| Environment cheat-sheet | [`docs/skills/SKILL.md`](docs/skills/SKILL.md) §3 + [`docs/reference/LOCAL-TOOLS.md`](docs/reference/LOCAL-TOOLS.md) |

The exhaustive reference docs now live under `docs/reference/`
(`API-REFERENCE.md`, `FIRESTORE-COLLECTIONS.md`, `DOMAIN-MODULES.md`);
`TECH-DEBT.md`, `PROJECT-PLAN.md`, `CLAUDE.md` stay at repo root. All are
indexed from `docs/skills/SKILL.md` §3. Feature specs, plans and ERP notes
moved under `docs/specs/`, `docs/plans/`, `docs/erp/` — see `PROJECT-PLAN.md`
"V8.15 · docs reorg" for the full map.
