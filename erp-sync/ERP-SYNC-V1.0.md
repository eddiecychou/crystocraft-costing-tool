# ERP → Supabase Sync — V1.0 (as-built)

**Status:** V1.0 — initial full archive complete and verified.
**Built:** 2026-07-15 → 2026-07-16 · **Documented:** 2026-07-17
**Owner:** Eddie (Crystocraft)

A one-way, read-only pipeline that mirrors the legacy **JES ERP** SQL Server
database into a **Supabase Postgres** warehouse, so the ERP data can be queried,
extracted, and built upon while the ERP itself is retired. The ERP remains the
source of truth; this pipeline never writes back to it.

---

## 1. What V1.0 delivers

- The **entire live ERP** mirrored into Supabase, schema `raw.*`, one table per
  ERP table, every column as `text`.
- **494 tables · 18,726,306 rows · ~2.9 GB** on Supabase (well under the 8 GB
  Pro allowance — the 42 GB source shrank because `nchar` padding and SQL Server
  indexes are not copied).
- Chinese text intact throughout (including legacy Big5 `varchar` tables).
- A repeatable refresh: re-run `python sync.py` from a LAN-connected machine.
- Bookkeeping in `meta.sync_state` (row counts + last-run timestamp per table).

Excluded on purpose: `SystemAudit` (2.3 GB audit log) and `LogonLog` — low value,
would waste disk. The separate `ITVS_*`, `UA_System`, and `JES_TEST*` databases
are out of scope.

---

## 2. Architecture

```
DB12 / SQDB08 (.251)          A LAN machine                Supabase Postgres (Seoul)
SQL Server 2008 R2            sync.py (python-tds)         raw.*   1:1 text mirror
JES_UnitedArt  ── SELECT ──►  reads + reconnects   ──────► meta.sync_state  bookkeeping
(read-only login)            (LAN + internet)             app.*   (curated — build later)
```

- `raw.*` — near-verbatim mirror, all columns `text`. Bulletproof against source
  type/encoding quirks. This is what the sync writes.
- `meta.sync_state` — one row per synced table (name, last_watermark, last_run_at,
  row_count).
- `app.*` — curated views/tables you build over time on top of `raw`. The sync
  never touches this. **Not built in V1.0** — this is the next phase.

Modes per table (in `tables.yaml`):
- **full** — atomic `TRUNCATE` + reload in one transaction. Self-healing, needs
  no watermark. All 494 tables use this in V1.0.
- **incremental** — upsert rows past a stored watermark. Wired in code but not
  yet enabled for any table (see §7 TODO).

---

## 3. The environment (as discovered on-site)

| Thing | Value |
|---|---|
| ERP app | `jes.exe` (Delphi), config in `\\192.168.10.252\JES SHARE\JES\JES.ini` |
| DB engine | **Microsoft SQL Server 2008 R2** (v10.50.6000.34), machine `SQDB08` |
| DB host | `192.168.10.251,1433` (LAN only — not internet-exposed) |
| **Database** | **`JES_UnitedArt`** (JES.ini's `UNITEDART` is only an app alias) |
| Collation | Chinese (lcid 1028, zh-TW). Mostly Unicode `nvarchar`; some legacy `varchar` |
| Laptop link | USB-Ethernet on subnet 10 (e.g. `192.168.10.57`) + Wi-Fi/VPN for internet |

The sync host must be **dual-homed**: on the ERP LAN (to reach `.251`) *and* on
the internet (to reach Supabase). A directly-connected `/24` route to
`192.168.10.0` wins over the VPN's default route, so the VPN can stay on.

**Auth:** the `sa` password in `JES.ini` is app-encoded and unusable. The
read-only login was created by connecting as the Windows `administrator` account
via **NTLM** (a sysadmin). The sync itself uses a dedicated SQL login:

- **`erp_readonly`** — SQL auth, `db_datareader` on `JES_UnitedArt`, verified
  write-blocked. It *physically cannot* modify the ERP. Created by
  `create_readonly_login.sql` (git-ignored; contains the generated password).

**Target:** Supabase org *Crystocraft* (Pro), project **JES**
(`vpcwakkotlpfixqpzqmr`, region `ap-northeast-2` Seoul, Micro compute).
Connect via the **session pooler** (`aws-1-ap-northeast-2.pooler.supabase.com:5432`,
IPv4); the plain Direct connection is IPv6-only and not reachable from the LAN.

All credentials live only in `erp-sync/.env` (git-ignored).

---

## 4. Key technical decisions (and why)

- **Pure-Python drivers, no Homebrew/ODBC.** The on-site machine is an M1 Mac with
  no Homebrew, and the ERP LAN may lack internet. `python-tds` (MSSQL) is 100%
  pure Python — `pip install` and done, works offline. This is why the whole tool
  is portable to a Linux/ARM box (e.g. a Raspberry Pi) later with zero system deps.
  (`firebird-driver` + a vendored client `.pkg` were staged as a fallback before
  the engine was confirmed as MSSQL — unused now.)
- **Legacy `varchar` → server-side `NVARCHAR`.** Some old tables use non-Unicode
  `varchar`/`char`/`text` in Big5/cp950, and a few rows contain bytes invalid in
  that code page. Decoding them client-side threw `UnicodeDecodeError` and wedged
  the connection. Fix: the SELECT wraps those columns in
  `CONVERT(NVARCHAR(MAX), col)` so SQL Server converts to clean Unicode before it
  reaches Python. (`ItemBatchHeader` was the culprit that broke the first run.)
- **Strip `nchar` padding.** MSSQL `nchar` returns blank-padded to full width;
  string values are `rstrip`ped in the mirror — cleaner data and a huge size cut
  on wide tables.
- **`varbinary`/`rowversion` → hex text**, so binary columns are readable, not a
  Python `bytes` repr.
- **Write batch size 5000.** Measured against Supabase-Seoul: 5000 rows per
  `INSERT` is ~3.7× faster than 1000 (fewer round-trips); 10000 was slower.
- **Per-table resilience.** On any table failure the loop logs it, rolls back the
  target, and **reconnects the source** so one bad table can never cascade into a
  wipeout (this was the second fix from the first run).

---

## 4b. App read layer (`api_views.sql`) — the bridge to the costing app

The React/Firebase app reads ERP data through a curated layer, **never** `raw.*`:
- `public.erp_customer`, `public.erp_supplier` — plain views (live over `raw`).
- `public.erp_item` — a **materialized view** exposing the latest revision per
  code. `raw.item` is a revision-history table (~1.4M rows, ~44k codes, ~32
  revisions each); the matview collapses it to ~44k rows and is trigram-indexed
  for fast search.
- `public.erp_bom` + `explode_bom(code)` — the BOM layer. `raw.itemdetail` is the
  single-level BOM, revisioned (~10.3M rows); `erp_bom` is the current BOM (latest
  revision per parent, ~432k lines), and `explode_bom()` walks it recursively for
  a full multi-level explosion with extended quantities. Cost-bearing → admin-only.
- Both matviews must be **refreshed after each sync** — `sync.py` does this
  automatically via `refresh_views.sql` on a clean run.

Access path: browser → Netlify edge function `/api/erp` (verifies the caller's
Firebase token, requires `role: 'admin'`, queries the views with the Supabase
secret key server-side) → JSON. The Supabase key and the ERP data never reach the
browser. The whole endpoint is **admin-only** because the item view carries costs.
Phase 1 = customer/supplier lookup; Phase 2 = item master (with costs); Phase 3 =
BOM explosion; Phase 4 = sales invoices + sales orders; Phase 5 = purchase orders
(all with a header search + a line-items/surcharge modal showing the full money
breakdown: subtotal − discount + surcharges + tax = total, deposit, balance). NB:
invoices/orders/POs are transaction data that change daily, so the app labels them
"as of last sync" until the incremental nightly sync is enabled (owner handling
that separately).

---

## 5. Files

| File | What it is |
|---|---|
| `sync.py` | the sync tool (read it — short and commented) |
| `tables.yaml` | which tables to sync and how (494 tables, giants last) |
| `probe.py` | Step-0 engine detector (TCP-probes 1433/3050; read-only) |
| `discover.py` | read-only schema catalog: tables + row counts + DB size |
| `validate.sql` | post-sync spot-checks (counts, dupes, orphans, samples) |
| `create_readonly_login.sql` | creates `erp_readonly` (git-ignored — has password) |
| `api_views.sql` | curated read-layer for the app: `erp_customer`, `erp_supplier` (views) + `erp_item` (materialized view, latest revision per code). Re-runnable. |
| `refresh_views.sql` | refreshes the materialized views; `sync.py` runs it automatically on a clean sync |
| `.env` | all credentials + connection strings (git-ignored) |
| `.env.example` | template |
| `requirements.txt` | Python deps (pure-Python drivers) |
| `README.md` | original design/plan write-up |
| `RUNBOOK-mac.md` | on-site quickstart for this Mac |
| `ERP-SYNC-V1.0.md` | this document |
| `vendor/` | staged Firebird client installer (unused; git-ignored) |
| `.venv/` | Python environment (git-ignored) |

---

## 6. How to run a refresh

From a machine on the ERP LAN **and** the internet (e.g. the on-site Mac):

```bash
cd erp-sync
source .venv/bin/activate
python probe.py          # optional: confirm 1433 is reachable
python sync.py --dry-run # optional: read source, write nothing, report counts
python sync.py           # full refresh of every table in tables.yaml
```

Full mode is idempotent and self-healing: re-running truncates and reloads each
table, and a failed table is logged and skipped without stopping the rest. A full
refresh currently re-pulls everything, including `ItemDetail` (~1h40m over the
Seoul link). See §7 for making refreshes incremental.

Single table: `python sync.py --table Customer`. Log: `sync.log`.

---

## 7. Known limits & next steps (post-V1.0)

1. **Incremental not yet enabled.** All four giants have a PK + `LastUpdate`
   column, so they're incremental-ready, which would cut a refresh from ~2 hours
   to minutes. Two things needed first:
   - `ensure_target_table` does **not** create a unique index, so the upsert's
     `ON CONFLICT (pk)` will fail — add a unique index on the pk column(s) for
     incremental tables.
   - Validate that `LastUpdate` really changes on every *edit* (not just insert);
     if a table's isn't reliable, keep it on periodic full-replace.
2. **Scheduling / host.** V1.0 runs manually from the laptop on-site. Owner's
   decision: run occasional refreshes from the laptop for now (infrequent),
   deferring a permanent always-on LAN box (a mini-PC or Raspberry Pi would run
   this unchanged, since the drivers are pure Python).
3. **Curated `app.*` layer.** Build clean, typed views on top of `raw.*` for the
   apps you want (item-cost lookups, BOM explorer, order history, etc.).
4. **Row deltas.** A V1.0 refresh's static tables match source exactly; busy
   transaction tables trail source by tens–hundreds of rows between runs — normal
   live activity, closed on the next refresh.

---

## 8. Data overview (from the initial load)

18.7 M rows across 16 business areas. Two tables dominate (`ItemDetail` 10.3 M,
`Item` 1.4 M ≈ 63% of rows); most tables are small reference data. A live,
searchable map of all 494 tables was generated as a private Artifact.

| Business area | Tables | Rows |
|---|--:|--:|
| Items & Costing | 51 | 14,874,807 |
| Job Orders / Production | 58 | 3,329,004 |
| Sales / Invoicing | 33 | 354,784 |
| Purchasing | 22 | 87,112 |
| Quotation | 23 | 55,148 |
| System / Config / Users | 75 | 11,435 |
| Stones / Materials | 26 | 6,956 |
| Accounting / Finance | 63 | 4,392 |
| Design | 5 | 1,414 |
| Customers | 19 | 1,095 |
| Other / Reference | 36 | 114 |
| Declaration / Hallmark | 10 | 23 |
| Integrations (Reach/Tradelink) | 11 | 21 |
| Online Orders (IOOS) | 13 | 1 |
| Consignment | 23 | 0 (module unused) |
| POS / Retail | 26 | 0 (module unused) |

---

## Changelog

- **V1.0 (2026-07-16)** — Initial full archive. 494 tables, 18.7 M rows into
  Supabase `raw.*`. MSSQL via pure-Python `python-tds`; legacy-varchar and
  encoding handling; write-batch tuning; per-table reconnect resilience;
  read-only login; session-pooler target. Initial load verified (counts, Chinese
  text, disk).
