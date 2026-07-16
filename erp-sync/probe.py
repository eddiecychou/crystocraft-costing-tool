#!/usr/bin/env python3
"""
Step 0 helper — figure out WHICH database engine the ERP uses, from your laptop,
before installing any drivers. Pure Python standard library: no pip, no venv, no
ODBC needed. This is the macOS/Linux equivalent of the README's PowerShell
`Test-NetConnection` checks.

    python3 probe.py                 # probes DB12 (.251) on the usual ports
    python3 probe.py 192.168.10.251  # or point it at a specific host

What it tells you:
  * port 1433 open  -> Microsoft SQL Server        -> SOURCE_ENGINE=mssql
  * port 3050 open  -> Firebird / InterBase         -> SOURCE_ENGINE=firebird
  * both closed     -> firewall on DB12, wrong host, or the DB is on another VM

It only opens a TCP socket and closes it. It sends no queries and cannot touch,
slow, or corrupt the ERP.
"""
import socket
import sys

# host -> which ports mean what
PORTS = {
    1433: ("Microsoft SQL Server", "SOURCE_ENGINE=mssql"),
    3050: ("Firebird / InterBase", "SOURCE_ENGINE=firebird"),
    1521: ("Oracle (less likely, but Delphi ERPs sometimes use it)", "—"),
    5432: ("PostgreSQL (unlikely for a legacy ERP)", "—"),
}

def check(host, port, timeout=3.0):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return True
    except Exception:
        return False
    finally:
        s.close()

def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "192.168.10.251"
    print(f"Probing {host} (DB12 expected)  — TCP connect only, read-nothing\n")
    hits = []
    for port, (engine, envhint) in PORTS.items():
        ok = check(host, port)
        mark = "OPEN " if ok else "closed"
        print(f"  {host}:{port:<5}  {mark}   {engine}")
        if ok and envhint != "—":
            hits.append((port, engine, envhint))

    print()
    if not hits:
        print("No known DB port answered. Likely causes, in order:")
        print("  1. Firewall on DB12 blocks your laptop's subnet (add an inbound rule).")
        print("  2. The DB is actually on a different VM (check APPS .252's")
        print("     connection config: a .ini / .udl / BDE alias, or the")
        print("     jes.exe data-file path).")
        print("  3. You're not on the LAN yet / network drive not mapped.")
        sys.exit(1)

    for port, engine, envhint in hits:
        print(f"-> {engine} is listening on {port}. Set  {envhint}  in .env")
    print("\nNext: create the read-only login, then confirm a plain SELECT works")
    print("from a GUI client (Azure Data Studio / DBeaver) BEFORE running sync.py.")

if __name__ == "__main__":
    main()
