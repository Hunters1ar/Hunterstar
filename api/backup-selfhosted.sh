#!/usr/bin/env bash
set -euo pipefail
umask 077
APP_DIR=/opt/portfolio-api
BACKUP_ROOT=${BACKUP_ROOT:-/root/portfolio-backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"
runuser -u postgres -- pg_dump -p 5433 -Fc portfolio > "$DEST/portfolio.dump"
tar -czf "$DEST/bucket.tar.gz" -C "$APP_DIR" bucket
cp "$APP_DIR/.env" "$DEST/api.env"
echo "Backup saved: $DEST"
