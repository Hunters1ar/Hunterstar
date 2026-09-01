# Hunters VPS Relay

This service runs on your VPS and creates temporary share URLs for the VS Code extension.

## Flow

1. The extension starts the local Hunters live server.
2. The extension connects to the VPS relay at `/tunnel`.
3. The relay creates a random URL like `https://live.example.com/s/<session>/`.
4. Visitors open that URL. The VPS forwards each request through the extension tunnel to your local server.
5. Browser reload events also pass through the VPS.
6. The URL disappears when the extension disconnects or when all viewers leave and the idle timeout passes.

## Environment

```bash
RELAY_HOST=0.0.0.0
RELAY_PORT=8090
PUBLIC_BASE_URL=http://34.10.243.64:8090
RELAY_TOKEN=
IDLE_TIMEOUT_MS=120000
REQUEST_TIMEOUT_MS=30000
MAX_BODY_BYTES=10485760
MAX_SESSIONS=100
MAX_SESSIONS_PER_IP=5
SESSION_CREATE_WINDOW_MS=60000
MAX_SESSION_CREATES_PER_WINDOW=20
SESSION_TTL_MS=21600000
```

`PUBLIC_BASE_URL` can be `http://your-vps-ip:8000` while testing, or an HTTPS domain behind Nginx.
The relay automatically loads `.env` from the repo root or `relay/.env`; values in `relay/.env` win if both files exist.

## Run

```bash
npm install --production
cp relay/.env.example .env
nano .env
npm run relay
```

For PM2:

```bash
pm2 start npm --name hunters-relay -- run relay
pm2 restart hunters-relay --update-env
pm2 logs hunters-relay --lines 20
```

## Update an existing VPS relay

Use this when deploying a new extension/relay release such as `0.0.15`:

```bash
cd /path/to/hunterstar-live-server
git pull
npm ci --omit=dev
pm2 restart hunters-relay --update-env
pm2 logs hunters-relay --lines 50
curl -fsS http://127.0.0.1:8090/healthz
```

If the relay is behind Nginx, make sure `PUBLIC_BASE_URL` matches the public HTTPS domain:

```bash
PUBLIC_BASE_URL=https://hunterstaronline.online
RELAY_PORT=8090
RELAY_TOKEN=
```

The relay must receive both normal HTTP requests and WebSocket upgrades. A typical Nginx proxy target is:

```nginx
location / {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Production extension users should not set anything locally. The bundled extension already points at the Hunters relay.

For a private relay, set this VS Code setting locally:

```json
{
  "hunters-live-server.relayUrl": "ws://YOUR_VPS_IP:8000/tunnel"
}
```

For HTTPS behind Nginx, use:

```json
{
  "hunters-live-server.relayUrl": "wss://live.example.com/tunnel"
}
```

For a private relay only, set `RELAY_TOKEN` on the server and configure `hunters-live-server.relayToken` locally with the same value.

Do not ship a shared token inside a public extension because users can read it from the package and inspect the WebSocket authorization header. If the relay is meant for all extension users, leave `RELAY_TOKEN` empty and rely on server-side limits, abuse monitoring, or real per-user authentication.

