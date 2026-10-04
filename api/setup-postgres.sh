#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/opt/portfolio-api
if [ "$(id -u)" -ne 0 ]; then echo 'Run as root'; exit 1; fi
if ! command -v pg_createcluster >/dev/null; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-client
fi
VERSION=$(ls /usr/lib/postgresql | sort -V | tail -1)
# A separate cluster leaves databases belonging to the other VPS apps untouched.
chmod o+x "$APP_DIR"
install -d -o postgres -g postgres -m 700 "$APP_DIR/memory"
if ! pg_lsclusters -h | awk '$2 == "portfolio" { found=1 } END { exit !found }'; then
  pg_createcluster "$VERSION" portfolio --datadir="$APP_DIR/memory/pgdata" --port=5433 --start-conf=auto \
    -- --auth-local=peer --auth-host=scram-sha-256
fi
pg_conftool "$VERSION" portfolio set listen_addresses localhost
pg_ctlcluster "$VERSION" portfolio start || [ "$(pg_lsclusters -h | awk '$2=="portfolio" {print $4}')" = online ]
if ! grep -q '^DATABASE_URL=' "$APP_DIR/.env"; then
  PASSWORD=$(openssl rand -hex 32)
  runuser -u postgres -- psql -p 5433 -v ON_ERROR_STOP=1 -c "CREATE USER portfolio_api PASSWORD '$PASSWORD';" >/dev/null
  runuser -u postgres -- createdb -p 5433 -O portfolio_api portfolio
  printf '\nDATABASE_URL=postgresql://portfolio_api:%s@127.0.0.1:5433/portfolio\nBUCKET_DIR=%s/bucket\nPUBLIC_API_URL=https://api.hunterstar.uz\n' "$PASSWORD" "$APP_DIR" >> "$APP_DIR/.env"
fi
chmod 600 "$APP_DIR/.env"
echo 'Portfolio PostgreSQL ready on 127.0.0.1:5433; data in /opt/portfolio-api/memory/pgdata'
