# ERP → Supabase Sync

A small, reviewable Python tool to copy the legacy ERP database into a Supabase
Postgres database, one-way and read-only, so we can slowly extract useful data
and retire the ERP by end of year.

> **If you are a fresh Claude Desktop / new person reading this on the laptop:**
> this folder is self-contained. Read this file top to bottom before running
> anything. The single most important step is **Step 0 — confirm the database
> engine** — do not skip it.

---

## The environment (Crystocraft LAN)

- Your laptop joins the local network as `192.168.10.XX`.
- **APPS** VM (`192.168.10.252`, Windows Server 2012 R2) runs the ERP app
  `jes.exe` (a Delphi program).
- **DB12** VM (`192.168.10.251`, Windows Server 2012 R2) holds the database.
- The OS is **2012 R2** (modern enough — ignore any advice written for "Server
  2003"; modern Python and drivers work fine).
- **Everything runs from your laptop.** Nothing is installed on either server.
  Read-only access cannot stop or corrupt the ERP.

---

## Design in one picture

```
DB12 .251                YOUR LAPTOP                 Supabase Postgres
(ERP DB, read-only) ───►  sync.py  ───────────────►  raw.*   (dumb 1:1 mirror)
  SELECT only            (LAN client)                app.*   (you build later)
                                                     meta.sync_state (bookkeeping)
```

- `raw.*` — a near-verbatim copy of each ERP table, **all columns as text**.
  Ugly but bulletproof against type/encoding surprises.
- `app.*` — curated tables/views YOU build over time on top of `raw`. The sync
  never touches this. This is where "extract the useful data" happens.
- `meta.sync_state` — records the last run + watermark per table.

Two modes per table (set in `tables.yaml`):
- **full** — atomic `TRUNCATE` + reload in one transaction. Self-healing, needs
  no `updated_at`. Use for anything under ~100k rows (probably most tables).
- **incremental** — upsert rows newer than the stored watermark. Only for the
  few genuinely large, append-mostly tables.

---

## Step 0 — Confirm the database engine (do this first!)

`jes.exe` is a Delphi app. Delphi ERPs are **often Firebird/Interbase, not
Microsoft SQL Server**. If you build against the wrong one, nothing connects.
Spend 30 minutes confirming, on **DB12 (192.168.10.251)**:

1. `services.msc` → look for `SQL Server (MSSQLSERVER)` vs `Firebird Server` vs
   `InterBase`.
2. Which port answers? From your laptop (PowerShell):
   ```powershell
   Test-NetConnection 192.168.10.251 -Port 1433   # MSSQL
   Test-NetConnection 192.168.10.251 -Port 3050   # Firebird / Interbase
   ```
3. On **APPS (.252)**, find how `jes.exe` connects — a `.ini` / `.udl` file, a
   BDE alias, or a connection string. Data file extension is a giveaway:
   `.mdf/.ldf` = MSSQL, `.fdb/.gdb` = Firebird/Interbase.

Set `SOURCE_ENGINE` in `.env` to `mssql` or `firebird` accordingly. The script
supports both; only the connection function and column-list query differ.

## Step 0b — Check the database size vs Supabase tier

Supabase **free tier = 500 MB**. A full ERP with history may exceed it.
- MSSQL: `EXEC sp_spaceused;` (whole DB) — or check per-table.
- Firebird: look at the `.fdb` file size.

If useful data is over ~400 MB, either upgrade to Supabase Pro (8 GB, ~$25/mo)
or only sync the tables you actually need (that's fine — this is a retirement).

---

## Setup (on your laptop)

1. Install Python 3.11+ and, **for MSSQL only**, Microsoft's
   "ODBC Driver 18 for SQL Server".
2. In this folder:
   ```
   python -m venv .venv
   .venv\Scripts\activate          # Windows   (mac/linux: source .venv/bin/activate)
   pip install -r requirements.txt
   ```
3. Create the read-only source login (see **Security** below).
4. Create a Supabase project. Copy `.env.example` → `.env` and fill it in.

---

## Running it

Always dry-run first — it reads the source and reports counts but writes nothing:

```
python sync.py --table Customer --dry-run     # one table, no writes
python sync.py --table Customer               # one table, for real
python sync.py --dry-run                       # all tables, no writes
python sync.py                                 # all tables, for real
```

Then run the checks in `validate.sql`.

---

## Rollout plan (do it in this order)

1. **Step 0 + 0b** above — engine + size. Don't skip.
2. Create the read-only login; confirm a plain `SELECT TOP 10` works from your
   laptop with a GUI (DBeaver / Azure Data Studio) **before** running Python. A
   failure here is a driver/firewall/auth problem, not a code problem.
3. Stand up Supabase; the script auto-creates the `raw` and `meta` schemas.
4. `python sync.py --table Customer --dry-run` → sanity-check counts.
5. `python sync.py --table Customer` → run `validate.sql`.
6. **Spot-check Chinese text** on that table. Fix encoding now if garbled,
   before doing 50 more tables.
7. Add tables to `tables.yaml` one at a time, small → large, each with
   dry-run → real → validate.
8. Once ~5 core tables are trustworthy, schedule a nightly run with **Windows
   Task Scheduler** on the laptop (or a small always-on LAN machine).
9. **Keep it one-way forever.** Never write back into an ERP you're retiring.

---

## Incremental sync — how to detect changes safely (§4)

Prefer the simplest option each table supports:

1. **Full replace** (default) — no watermark needed. Best for small/medium
   tables. Self-healing.
2. **`updated_at` / `LastModified` watermark** — only if you've *verified* the
   column changes on every UPDATE (many ERPs set it on insert but not edit).
3. **Identity / PK watermark** — for append-only tables (ledgers, invoice
   lines): `WHERE OrderNo > :last`. Reliable only if rows aren't edited after
   creation — confirm per table.
4. **Hash/checksum fallback** — no reliable watermark, too big to full-replace:
   compare `PK + row hash` on both sides, sync diffs. Heavier; last resort.
5. **DB change-log trigger** — avoid. It means altering a production ERP you're
   retiring.

For this project, options **1 and 3 cover ~95% of tables.** Don't over-build.

---

## Security (§6)

- **Credentials live only in `.env`** (git-ignored here). Never in `.py` or
  `.yaml`. A `.env.example` with blanks is committed as a template.
- **Create a dedicated read-only SQL login** — never use `sa` or the ERP app
  login. On MSSQL:
  ```sql
  CREATE LOGIN erp_readonly WITH PASSWORD = '...';
  CREATE USER  erp_readonly FOR LOGIN erp_readonly;
  ALTER ROLE db_datareader ADD MEMBER erp_readonly;   -- read-only, cannot write
  ```
  This is the strongest safety guarantee: the sync *physically cannot* modify
  the ERP.
- **Supabase:** use the **direct Postgres connection string (port 5432)**, not
  the anon/service API keys. Don't expose the `raw` schema via PostgREST.
- Keep the ERP DB port on the LAN only — never open it to the internet.

---

## What can go wrong on these systems (in likelihood order)

- **It's not MSSQL.** See Step 0. Verify before building.
- **TLS handshake fails** with ODBC Driver 18 against older SQL Server →
  `Encrypt=no;TrustServerCertificate=yes` is already set; if it still fails, set
  `MSSQL_DRIVER=ODBC Driver 17 for SQL Server` in `.env`.
- **Firewall on DB12** blocks 1433/3050 from your laptop subnet → add an inbound
  rule, or run from a machine that can already reach it.
- **Named instance** (`DB12\SQLEXPRESS`) needs SQL Browser running, or specify
  the port directly.
- **Chinese-text mojibake** — legacy `varchar` in a Big5/GBK collation.
  `nvarchar` is safe. Spot-check early (validate.sql §5).
- **Long scans during business hours** add load. Read-only won't *stop* the
  server, but run big pulls after hours; go easy at month-end close.

---

## Files in this folder

| File              | What it is |
|-------------------|------------|
| `sync.py`         | the sync tool — read it, it's short and commented |
| `tables.yaml`     | which tables to sync and how (edit this to add tables) |
| `.env.example`    | template for credentials → copy to `.env` |
| `requirements.txt`| Python packages to install on the laptop |
| `validate.sql`    | post-sync checks (counts, dupes, orphans, samples) |
| `.gitignore`      | keeps `.env` and `sync.log` out of git |

---

## Honest scope note

This is deliberately a **simple, reliable v1**: one-way, read-only, mostly full
snapshots, easy to review and modify. It is *not* real-time replication and
doesn't try to model the final clean schema — that's intentional. Build the
curated `app.*` layer at your own pace as you discover what data is worth
keeping. The ERP stays the source of truth until you actively decide to retire
it.
