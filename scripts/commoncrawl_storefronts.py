"""List *.tcgplayerpro.com hosts seen by Common Crawl.

Queries Common Crawl's Parquet URL index over HTTPS with DuckDB. The index is
sorted by SURT URL, so only the row groups covering "com,tcgplayerpro," are
read (about 30s per crawl). The public CDX API times out on wildcard queries.

    pip install duckdb
    python3 scripts/commoncrawl_storefronts.py CC-MAIN-2025-51 CC-MAIN-2025-38 ...

Crawl IDs: https://index.commoncrawl.org/collinfo.json
Prints one host per line. Behind a proxy, set HTTPS_PROXY (and CA_CERT_FILE if
the proxy re-signs TLS).
"""

import gzip
import io
import os
import sys
import urllib.request

import duckdb

DATA = "https://data.commoncrawl.org/"


def warc_index_files(crawl: str) -> list[str]:
    with urllib.request.urlopen(f"{DATA}crawl-data/{crawl}/cc-index-table.paths.gz") as res:
        paths = gzip.open(io.BytesIO(res.read()), "rt").read().split()
    return [DATA + p for p in paths if "/subset=warc/" in p]


def hosts_in_crawl(con: duckdb.DuckDBPyConnection, crawl: str) -> set[str]:
    rows = con.execute(
        """SELECT DISTINCT lower(url_host_name) FROM read_parquet(?)
           WHERE url_surtkey >= 'com,tcgplayerpro,' AND url_surtkey < 'com,tcgplayerpro-'""",
        [warc_index_files(crawl)],
    ).fetchall()
    return {host for (host,) in rows}


def main(crawls: list[str]) -> None:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET http_retries=5; SET http_timeout=120000;")
    if proxy := os.environ.get("HTTPS_PROXY"):
        con.execute(f"SET http_proxy='{proxy.removeprefix('http://')}'")
    if ca := os.environ.get("CA_CERT_FILE"):
        con.execute(f"SET ca_cert_file='{ca}'")
    hosts: set[str] = set()
    for crawl in crawls:
        found = hosts_in_crawl(con, crawl)
        print(f"{crawl}: {len(found)} hosts", file=sys.stderr)
        hosts |= found
    for host in sorted(h for h in hosts if h.count(".") == 2 and not h.startswith("www.")):
        print(host)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
