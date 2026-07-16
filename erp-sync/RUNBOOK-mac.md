# On-site quickstart (this M1 Mac)

The full plan is in `README.md`. This is the copy-paste sequence for **this
laptop**, which uses **pure-Python drivers** (no Homebrew / unixODBC). Prep is
already done: `.venv` exists with all drivers, `.env` is pre-filled with the
`.251` / `erp_readonly` values, and the Firebird installer is staged in
`vendor/`. You need internet AND the ERP LAN at the same time (Wi-Fi + Ethernet)
because the source is on the LAN and Supabase is in the cloud.

```bash
cd "erp-sync"
source .venv/bin/activate          # note: mac uses /bin/activate, not \Scripts\
```

## 1. Confirm the engine (Step 0) — 30 seconds
```bash
python3 probe.py                   # TCP-probes 192.168.10.251, tells you which engine
```
- Port **1433 open → MSSQL** → `.env` already set to `SOURCE_ENGINE=mssql`,
  `MSSQL_DRIVER_KIND=tds`. **Nothing else to install.**
- Port **3050 open → Firebird** → set `SOURCE_ENGINE=firebird` in `.env`, then:
  ```bash
  sudo installer -pkg vendor/Firebird-5.0.4-macos-arm64.pkg -target /   # offline OK
  ```

## 2. Fill the secrets in `.env`
- The read-only login password (`MSSQL_PWD` or `FB_PWD`) — create the login per
  README §Security first.
- `MSSQL_DB` (the ERP database name) or `FB_DATABASE` (server-side `.fdb` path).
- `SUPABASE_DB_URL` — the direct port-5432 URI from the Supabase dashboard.

## 3. See the real schema (read-only) before touching Supabase
```bash
python3 discover.py                # every table + row count + total DB size
python3 discover.py --yaml --top 40  # starter tables.yaml block for the big ones
```
Use this to (a) check size vs Supabase's 500 MB free tier and (b) replace the
placeholder `Customer`/`Product` in `tables.yaml` with real JES table names.

## 4. Sync, smallest table first
```bash
python3 sync.py --table <SmallTable> --dry-run   # reads source, writes nothing
python3 sync.py --table <SmallTable>             # for real
# then run validate.sql on Supabase, and SPOT-CHECK Chinese text before scaling up
```

## Fallbacks
- MSSQL TLS/login weirdness with an old SQL Server: python-tds negotiates the
  old TDS protocol automatically — usually just works. If auth fails, re-check
  the login from a GUI client (Azure Data Studio) first.
- Firebird can't find the client lib after install: uncomment `FB_CLIENT_LIB`
  in `.env`.
- No internet on the LAN: you can still run `probe.py` and `discover.py` (both
  LAN-only). The actual `sync.py` push needs Supabase reachable — tether or move
  to a spot with both networks.
```
