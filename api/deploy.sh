#!/bin/bash
# ============================================================
# Portfolio API - VPS Deployment Script
# Run this ON the VPS after uploading or extracting the api folder.
# ============================================================

set -euo pipefail

APP_DIR="/opt/portfolio-api"
ADMIN_DIR="/var/www/admin-hunterstar"
PRIVATE_DIR="/var/www/private-hunterstar"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN_SITE_SOURCE="${ADMIN_SITE_SOURCE:-$(cd "$SCRIPT_DIR/.." && pwd)/site}"
EXISTING_SESSION_SECRET=""
EXISTING_TWO_FACTOR_ISSUER=""
EXISTING_PRIVATE_TWO_FACTOR_ISSUER=""
EXISTING_YOUTUBE_API_KEY=""
EXISTING_YOUTUBE_PLAYLIST_ID=""

if [ -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env" "$APP_DIR/.env.bak"
    EXISTING_SESSION_SECRET="$(grep -E '^SESSION_SECRET=' "$APP_DIR/.env" | head -n 1 | cut -d '=' -f 2- || true)"
    EXISTING_TWO_FACTOR_ISSUER="$(grep -E '^TWO_FACTOR_ISSUER=' "$APP_DIR/.env" | head -n 1 | cut -d '=' -f 2- || true)"
    EXISTING_PRIVATE_TWO_FACTOR_ISSUER="$(grep -E '^PRIVATE_TWO_FACTOR_ISSUER=' "$APP_DIR/.env" | head -n 1 | cut -d '=' -f 2- || true)"
    EXISTING_YOUTUBE_API_KEY="$(grep -E '^YOUTUBE_API_KEY=' "$APP_DIR/.env" | head -n 1 | cut -d '=' -f 2- || true)"
    EXISTING_YOUTUBE_PLAYLIST_ID="$(grep -E '^YOUTUBE_PLAYLIST_ID=' "$APP_DIR/.env" | head -n 1 | cut -d '=' -f 2- || true)"
    EXISTING_OPEN_ROUTER_API_KEY="$(grep -E '^OPEN_ROUTER_API_KEY=' "$APP_DIR/.env" | head -n 1 | cut -d '=' -f 2- || true)"
fi

env_quote() {
    printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

strip_env_quotes() {
    local value="$1"
    local first="${value:0:1}"
    local last="${value: -1}"

    if [ "${#value}" -ge 2 ] && { { [ "$first" = "'" ] && [ "$last" = "'" ]; } || { [ "$first" = '"' ] && [ "$last" = '"' ]; }; }; then
        printf '%s' "${value:1:${#value}-2}"
        return
    fi

    printf '%s' "$value"
}

EXISTING_SESSION_SECRET="$(strip_env_quotes "$EXISTING_SESSION_SECRET")"
EXISTING_TWO_FACTOR_ISSUER="$(strip_env_quotes "$EXISTING_TWO_FACTOR_ISSUER")"
EXISTING_PRIVATE_TWO_FACTOR_ISSUER="$(strip_env_quotes "$EXISTING_PRIVATE_TWO_FACTOR_ISSUER")"

if [[ "$EXISTING_SESSION_SECRET" =~ ([[:xdigit:]]{64}) ]]; then
    EXISTING_SESSION_SECRET="${BASH_REMATCH[1]}"
else
    EXISTING_SESSION_SECRET=""
fi

if [ "${#EXISTING_TWO_FACTOR_ISSUER}" -gt 128 ]; then
    EXISTING_TWO_FACTOR_ISSUER=""
fi

if [ "${#EXISTING_PRIVATE_TWO_FACTOR_ISSUER}" -gt 128 ]; then
    EXISTING_PRIVATE_TWO_FACTOR_ISSUER=""
fi

SESSION_SECRET="${SESSION_SECRET:-${EXISTING_SESSION_SECRET:-$(openssl rand -hex 32)}}"
SESSION_SECRET="$(strip_env_quotes "$SESSION_SECRET")"
if ! [[ "$SESSION_SECRET" =~ ^[[:xdigit:]]{64}$ ]]; then
    SESSION_SECRET="$(openssl rand -hex 32)"
fi

TWO_FACTOR_ISSUER="${TWO_FACTOR_ISSUER:-${EXISTING_TWO_FACTOR_ISSUER:-Hunterstar Admin}}"
TWO_FACTOR_ISSUER="$(strip_env_quotes "$TWO_FACTOR_ISSUER")"
if [ -z "$TWO_FACTOR_ISSUER" ] || [ "${#TWO_FACTOR_ISSUER}" -gt 128 ]; then
    TWO_FACTOR_ISSUER="Hunterstar Admin"
fi

PRIVATE_TWO_FACTOR_ISSUER="${PRIVATE_TWO_FACTOR_ISSUER:-${EXISTING_PRIVATE_TWO_FACTOR_ISSUER:-Hunterstar Private}}"
PRIVATE_TWO_FACTOR_ISSUER="$(strip_env_quotes "$PRIVATE_TWO_FACTOR_ISSUER")"
if [ -z "$PRIVATE_TWO_FACTOR_ISSUER" ] || [ "${#PRIVATE_TWO_FACTOR_ISSUER}" -gt 128 ]; then
    PRIVATE_TWO_FACTOR_ISSUER="Hunterstar Private"
fi

# YouTube key is secret: keep whatever is already on the server (or an env
# override) so redeploys never wipe it. Playlist ID is public and falls back
# to the default.
YOUTUBE_API_KEY="${YOUTUBE_API_KEY:-$EXISTING_YOUTUBE_API_KEY}"
YOUTUBE_API_KEY="$(strip_env_quotes "$YOUTUBE_API_KEY")"
YOUTUBE_PLAYLIST_ID="${YOUTUBE_PLAYLIST_ID:-${EXISTING_YOUTUBE_PLAYLIST_ID:-PLrEYU1gx-0UOsV8mDxgkbBc_qqleKsRxW}}"
YOUTUBE_PLAYLIST_ID="$(strip_env_quotes "$YOUTUBE_PLAYLIST_ID")"

OPEN_ROUTER_API_KEY="${OPEN_ROUTER_API_KEY:-$EXISTING_OPEN_ROUTER_API_KEY}"
OPEN_ROUTER_API_KEY="$(strip_env_quotes "$OPEN_ROUTER_API_KEY")"

if [ -z "$YOUTUBE_API_KEY" ]; then
    echo "WARNING: YOUTUBE_API_KEY is empty. /api/playlist will return a config error."
    echo "         Add YOUTUBE_API_KEY=... to $APP_DIR/.env (it is preserved on future deploys)."
fi

echo "=== Setting up Portfolio API ==="

mkdir -p "$APP_DIR"

# Copy API files when this script is run from an upload or extract directory.
for file in server.js package.json package-lock.json ecosystem.config.js .env.example; do
    if [ -f "$SCRIPT_DIR/$file" ]; then
        cp "$SCRIPT_DIR/$file" "$APP_DIR/$file"
    fi
done

if [ -f "$SCRIPT_DIR/service-account.json" ]; then
    cp "$SCRIPT_DIR/service-account.json" "$APP_DIR/service-account.json"
fi

cd "$APP_DIR"

if [ ! -f service-account.json ]; then
    echo "Missing $APP_DIR/service-account.json"
    echo "Upload your Firebase service account JSON as service-account.json, then rerun this script."
    exit 1
fi

chmod 600 service-account.json

cat > .env << EOF
PORT=3001
ALLOWED_ORIGINS=https://hunterstar.uz,https://www.hunterstar.uz,https://admin.hunterstar.uz,https://private.hunterstar.uz
SESSION_SECRET=$(env_quote "$SESSION_SECRET")
TWO_FACTOR_ISSUER=$(env_quote "$TWO_FACTOR_ISSUER")
PRIVATE_TWO_FACTOR_ISSUER=$(env_quote "$PRIVATE_TWO_FACTOR_ISSUER")
FIREBASE_SERVICE_ACCOUNT=$(env_quote "$APP_DIR/service-account.json")
FIREBASE_API_KEY=AIzaSyDCmF8y4DXFqABNOuDtz6ytEUqJJcIFlMs
YOUTUBE_API_KEY=$(env_quote "$YOUTUBE_API_KEY")
YOUTUBE_PLAYLIST_ID=$(env_quote "$YOUTUBE_PLAYLIST_ID")
OPEN_ROUTER_API_KEY=$(env_quote "$OPEN_ROUTER_API_KEY")
EOF

# Preserve multiple AI keys from existing .env if they exist
if [ -f ".env.bak" ]; then
    grep -E '^(OPEN_ROUTER_API_KEY|AI_STUDIO_API_KEY)[0-9]*=' ".env.bak" >> .env || true
fi

echo "OK .env created"

if [ -f package-lock.json ]; then
    npm ci --omit=dev
else
    npm install --omit=dev
fi
echo "OK dependencies installed"

set -a
. "$APP_DIR/.env"
set +a

pm2 delete portfolio-api 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save
echo "OK PM2 started"

if [ -f "$ADMIN_SITE_SOURCE/admin.html" ]; then
    echo "=== Setting up Admin static site ==="
    mkdir -p "$ADMIN_DIR/css" "$ADMIN_DIR/js" "$ADMIN_DIR/assets"
    cp "$ADMIN_SITE_SOURCE/admin.html" "$ADMIN_DIR/admin.html"

    if [ -f "$ADMIN_SITE_SOURCE/css/styles.css" ]; then
        cp "$ADMIN_SITE_SOURCE/css/styles.css" "$ADMIN_DIR/css/styles.css"
    fi

    if [ -f "$ADMIN_SITE_SOURCE/css/admin-dashboard.css" ]; then
        cp "$ADMIN_SITE_SOURCE/css/admin-dashboard.css" "$ADMIN_DIR/css/admin-dashboard.css"
    fi

    if [ -f "$ADMIN_SITE_SOURCE/js/firebase-config.js" ]; then
        cp "$ADMIN_SITE_SOURCE/js/firebase-config.js" "$ADMIN_DIR/js/firebase-config.js"
    fi

    if [ -f "$ADMIN_SITE_SOURCE/js/admin.js" ]; then
        cp "$ADMIN_SITE_SOURCE/js/admin.js" "$ADMIN_DIR/js/admin.js"
    fi

    for ASSET_FILE in favicon-96x96.png favicon.svg favicon.ico apple-touch-icon.png site.webmanifest web-app-manifest-192x192.png web-app-manifest-512x512.png hunterstar.webp; do
        if [ -f "$ADMIN_SITE_SOURCE/$ASSET_FILE" ]; then
            cp "$ADMIN_SITE_SOURCE/$ASSET_FILE" "$ADMIN_DIR/$ASSET_FILE"
        fi
    done

    if [ -f "$ADMIN_SITE_SOURCE/assets/logo.png" ]; then
        cp "$ADMIN_SITE_SOURCE/assets/logo.png" "$ADMIN_DIR/assets/logo.png"
    fi

    if [ -f "$ADMIN_SITE_SOURCE/assets/hunterrealpic.png" ]; then
        cp "$ADMIN_SITE_SOURCE/assets/hunterrealpic.png" "$ADMIN_DIR/assets/hunterrealpic.png"
    fi

    find "$ADMIN_DIR" -type d -exec chmod 755 {} \;
    find "$ADMIN_DIR" -type f -exec chmod 644 {} \;
    echo "OK Admin static files installed"
else
    echo "Admin static source not found at $ADMIN_SITE_SOURCE; skipping admin site copy"
fi

PRIVATE_SITE_SOURCE="$ADMIN_SITE_SOURCE/private"
PRIVATE_INDEX_SOURCE=""

if [ -f "$PRIVATE_SITE_SOURCE/index.html" ]; then
    PRIVATE_INDEX_SOURCE="$PRIVATE_SITE_SOURCE/index.html"
elif [ -f "$ADMIN_SITE_SOURCE/private.html" ]; then
    PRIVATE_INDEX_SOURCE="$ADMIN_SITE_SOURCE/private.html"
fi

if [ -n "$PRIVATE_INDEX_SOURCE" ]; then
    echo "=== Setting up Private static site ==="
    mkdir -p "$PRIVATE_DIR/css" "$PRIVATE_DIR/js" "$PRIVATE_DIR/assets"
    cp "$PRIVATE_INDEX_SOURCE" "$PRIVATE_DIR/index.html"

    if [ -f "$PRIVATE_SITE_SOURCE/book.html" ]; then
        cp "$PRIVATE_SITE_SOURCE/book.html" "$PRIVATE_DIR/book.html"
    fi

    if [ -f "$ADMIN_SITE_SOURCE/css/styles.css" ]; then
        cp "$ADMIN_SITE_SOURCE/css/styles.css" "$PRIVATE_DIR/css/styles.css"
    fi

    if [ -f "$ADMIN_SITE_SOURCE/js/firebase-config.js" ]; then
        cp "$ADMIN_SITE_SOURCE/js/firebase-config.js" "$PRIVATE_DIR/js/firebase-config.js"
    fi

    if [ -f "$ADMIN_SITE_SOURCE/assets/logo.png" ]; then
        cp "$ADMIN_SITE_SOURCE/assets/logo.png" "$PRIVATE_DIR/assets/logo.png"
    fi

    for PRIVATE_ASSET in favicon-96x96.png favicon.svg favicon.ico apple-touch-icon.png site.webmanifest; do
        if [ -f "$ADMIN_SITE_SOURCE/$PRIVATE_ASSET" ]; then
            cp "$ADMIN_SITE_SOURCE/$PRIVATE_ASSET" "$PRIVATE_DIR/$PRIVATE_ASSET"
        fi
    done

    find "$PRIVATE_DIR" -type d -exec chmod 755 {} \;
    find "$PRIVATE_DIR" -type f -exec chmod 644 {} \;
    echo "OK Private static files installed"
else
    echo "Private static source not found at $ADMIN_SITE_SOURCE; skipping private site copy"
fi

cat > /etc/nginx/sites-available/portfolio-api << 'NGINX'
server {
    listen 80;
    server_name api.hunterstar.uz;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 50M;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/portfolio-api /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/admin.hunterstar.uz

cat > /etc/nginx/sites-available/000-hunterstar-admin << 'NGINX'
server {
    listen 80;
    server_name admin.hunterstar.uz;

    root /var/www/admin-hunterstar;
    index admin.html;

    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;

    location = / {
        try_files /admin.html =404;
    }

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \.(?:html|css|js)$ {
        add_header Cache-Control "no-store" always;
        add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
        try_files $uri =404;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/000-hunterstar-admin /etc/nginx/sites-enabled/000-hunterstar-admin

nginx -t && systemctl reload nginx
echo "OK Nginx configured"

certbot --nginx -d api.hunterstar.uz --non-interactive --agree-tos --email kyuter789@gmail.com
echo "OK SSL certificate obtained"
certbot --nginx -d admin.hunterstar.uz --non-interactive --agree-tos --email kyuter789@gmail.com
echo "OK Admin SSL certificate obtained"

if [ -f /etc/letsencrypt/live/admin.hunterstar.uz/fullchain.pem ]; then
    cat > /etc/nginx/sites-available/000-hunterstar-admin << 'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name admin.hunterstar.uz;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name admin.hunterstar.uz;

    root /var/www/admin-hunterstar;
    index admin.html;

    ssl_certificate /etc/letsencrypt/live/admin.hunterstar.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.hunterstar.uz/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;

    location = / {
        try_files /admin.html =404;
    }

    location / {
        try_files $uri $uri/ =404;
    }

    location ~* \.(?:html|css|js)$ {
        add_header Cache-Control "no-store" always;
        add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
        try_files $uri =404;
    }
}
NGINX

    ln -sf /etc/nginx/sites-available/000-hunterstar-admin /etc/nginx/sites-enabled/000-hunterstar-admin
    nginx -t && systemctl reload nginx
    echo "OK Admin HTTPS config normalized"
fi

echo ""
echo "=== DEPLOYMENT COMPLETE ==="
echo "API running at: https://api.hunterstar.uz"
echo "Health check:   https://api.hunterstar.uz/api/health"
echo "Admin console:  https://admin.hunterstar.uz"
