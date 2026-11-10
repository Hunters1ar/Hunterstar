# Portfolio pet API

The pet has its own Hermes 3 model process on **Hunterella, 127.0.0.1:8090**.
It uses Q4_K_M in its own process, four CPU threads, a lower scheduling priority,
one inference slot, and an 8 GB memory limit. The CLI's `llama-hunter.service`
and port **8080** are never restarted, edited, or used by this API.

The Python standard-library API runs on loopback port 8091. Caddy exposes only
its portfolio routes through the existing HTTPS domain:

- `POST https://image.hunterstar.uz/api/pet/chat`
- `GET https://image.hunterstar.uz/api/pet/health`

The pet route shares Hunterella's existing `image.hunterstar.uz` HTTPS host;
other paths retain the image service's existing proxy. `proxy.py` adds only the
pet handler and preserves all other Caddy routes. The former
`api.moonlightsoldiers.xyz` address no longer resolves to Hunterella and must not
be used by the portfolio.

Chat accepts `{ "messages": [{ "role": "user", "content": "Hello" }], "stream": true }`.
It returns `text/event-stream` with `start`, `token` (`{ "token": "…" }`), and
`done` (`{ "ok": true, "finishReason": "stop", "model": "Hunterstar-Pet-Hermes-3" }`)
events. Midstream failures use an `error` event. Tokens are flushed through Caddy
as they arrive and displayed immediately in the speech bubble. A missing `done`
event is treated as a failed reply; partial text does not enter conversation history.
Requests without `stream: true` retain the JSON reply format for older clients:
`{ "ok": true, "data": { "choices": [{ "message": { "role": "assistant", "content": "…" } }] } }`.
The website uses this endpoint in local previews and production. Browser origins
are limited to the portfolio domains and localhost/127.0.0.1 on port 3000.

The model key is generated on Hunterella in `/etc/portfolio-pet/model.key`,
readable only by root and the dedicated API group. It never enters the browser
or repository. Visitors cannot override the model, system prompt, or token cap.
Conversation input is bounded to eight recent turns and 6000 UTF-8 bytes;
casual replies are capped at 60 tokens; explicit code or detailed requests allow
up to 160. At 4.6 tokens/second, a full 60-token reply still takes about 13 seconds;
streaming improves time to visible text without promising a three-second completion.
One generation runs at a time. Busy requests
receive HTTP 429 with `Retry-After`. Per-visitor and global limits bound resource
use. Responses and prompts are not logged or cached. The API has a 110-second
upstream deadline; the browser waits up to 125 seconds.

Run checks locally:

```powershell
python -m unittest discover -s api/pet -p "test_*.py"
npm run test:pet
```

The original systemd deployment is described below. The current production API
and model run in the `hunterella-ai` container, with ports 8090 and 8091 published
on the host's loopback interface. For a proxy-only update, validate and reload
host Caddy; do not run the systemd installer against these occupied ports.

For a systemd deployment, copy this directory to a temporary directory on Hunterella
using the existing SSH alias, then run `python3 install.py` there as root.
`python3 download-q3.py` obtains and verifies an optional additional Q3 model;
the CLI model remains in place. `python3 benchmark.py` measures only port 8090. The
installer checks port ownership, generates a separate model credential, starts
only the two pet services, waits for model readiness, backs up and validates
Caddy's config, and adds the pet route while preserving the other relays. It
checks that the CLI process ID and service-file checksum stayed unchanged.

The model API follows the [llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

On October 4, 2026, the same 60-token, deterministic introduction prompt measured
about 2.98 tokens/second with Q4_K_M and 2.57–2.62 with Q3_K_M. Warm first-token
times were 0.39 seconds for both; cold prompt evaluation took about 39 seconds.
The pet keeps Q4 because Q3 did not improve speed in this comparison. These are
server measurements, not latency guarantees; visitor prompts and server load vary.
