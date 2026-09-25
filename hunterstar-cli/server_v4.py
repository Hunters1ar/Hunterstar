#!/usr/bin/env python3
"""
HunterStar Intelect Server v4.0.0
- Removed: teacher_distillation, knowledge_rules, /intelect/distill, /intelect/instructions, /intelect/rule
- Kept: heavy_master_distillation, /intelect/heavy/distill, /intelect/heavy/strategies
- Baked fast system prompt as a static constant (no SQL injection)
"""
import json
import os
import urllib.request
from urllib.parse import urlparse, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler
import psycopg2

PORT = 8083
TELEGRAM_BOT_TOKEN = os.environ.get('ANALYTICS_BOT', '8731326573:AAGg9_VdlGc_5IaqNXJgNvHx8--1IgQH3Ks')
TELEGRAM_CHAT_ID = os.environ.get('ANALYTICS_CHAT_ID', '8950733976')

# ─── Baked Fast AI System Prompt ─────────────────────────────────────────────
# Static. Never injected from SQL. The 1.5B model only reads this.
FAST_SYSTEM_PROMPT = (
    "You are HunterStar AI: a sharp developer and cybersecurity assistant. "
    "Write code, debug, analyze files, run shell commands, explain technical concepts, "
    "system administration. Be direct and concise."
)
# ─────────────────────────────────────────────────────────────────────────────

def get_db():
    return psycopg2.connect("dbname=intelect user=root")

def escape_html(s):
    if not s:
        return ""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def send_telegram(text):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        payload = json.dumps({"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"}).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        print("[Analytics] Telegram send failed:", e)

def record_heavy_masterpiece(conn, task_intent, platform, shell, masterpiece_command,
                              strategy_summary='', avoid_patterns='', taught_by='cloud-master'):
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO heavy_master_strategies
                (task_intent, platform, shell, masterpiece_command, strategy_summary, avoid_patterns, taught_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (task_intent, platform, shell)
                DO UPDATE SET
                    masterpiece_command = EXCLUDED.masterpiece_command,
                    strategy_summary = EXCLUDED.strategy_summary,
                    avoid_patterns = EXCLUDED.avoid_patterns,
                    taught_by = EXCLUDED.taught_by,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id;
            """, (task_intent, platform, shell, masterpiece_command, strategy_summary, avoid_patterns, taught_by))
            row = cur.fetchone()
            conn.commit()
            return row[0] if row else None
    except Exception as e:
        print("[DB] record_heavy_masterpiece error:", e)
        conn.rollback()
        return None


class IntelectHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default access log

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')
        params = parse_qs(parsed.query)

        # ── Health / Stats ───────────────────────────────────────────────────
        if path in ['/health', '/intelect/health', '/stats', '/intelect/stats']:
            self._send_json(200, {
                "ok": True,
                "version": "4.0.0",
                "fast_prompt": FAST_SYSTEM_PROMPT,
                "teacher": "removed"
            })

        # ── Heavy Masterpiece Strategies ─────────────────────────────────────
        elif path in ['/heavy/strategies', '/intelect/heavy/strategies', '/api/intelect/heavy/strategies']:
            intent = (params.get('intent', [None])[0] or '').strip().lower()
            platform = (params.get('platform', ['all'])[0] or 'all').strip().lower()
            shell = (params.get('shell', ['all'])[0] or 'all').strip().lower()
            try:
                conn = get_db()
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT id, task_intent, platform, shell, masterpiece_command,
                               strategy_summary, avoid_patterns, taught_by, updated_at
                        FROM heavy_master_strategies
                        WHERE task_intent = %s
                          AND (platform = %s OR platform = 'all')
                          AND (shell = %s OR shell = 'all')
                        ORDER BY updated_at DESC
                        LIMIT 3;
                    """, (intent, platform, shell))
                    rows = cur.fetchall()
                conn.close()
                strategies = [
                    {
                        "id": r[0], "task_intent": r[1], "platform": r[2], "shell": r[3],
                        "command": r[4], "description": r[5], "avoid": r[6],
                        "taught_by": r[7], "updated_at": str(r[8])
                    }
                    for r in rows
                ]
                self._send_json(200, {"ok": True, "strategies": strategies})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})

        # ── Catch-all (legacy teacher endpoints return 410 Gone) ─────────────
        elif path in ['/instructions', '/intelect/instructions', '/intelect/distill', '/distill',
                      '/intelect/rule', '/rule']:
            self._send_json(410, {
                "ok": False,
                "error": "Endpoint removed in v4.0.0. Teacher/SQL injection system has been decommissioned.",
                "fast_prompt": FAST_SYSTEM_PROMPT
            })
        else:
            self._send_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        # ── Heavy Masterpiece Distillation ───────────────────────────────────
        if path in ['/heavy/distill', '/intelect/heavy/distill', '/api/intelect/heavy/distill']:
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                raw_body = self.rfile.read(content_len).decode('utf-8')
                data = json.loads(raw_body)

                prompt = data.get('prompt', '')
                task_intent = data.get('task_intent') or data.get('intent') or 'general_execution'
                platform = data.get('platform', 'all')
                shell = data.get('shell', 'all')
                trial_commands = data.get('trial_commands', [])
                steps_count = int(data.get('steps_count') or len(trial_commands) or 1)
                masterpiece_command = data.get('masterpiece_command', '')
                master_critique = data.get('master_critique', '')
                taught_by = data.get('taught_by') or 'cloud-master'
                latency_saved = float(data.get('latency_saved_est_sec', 0.0))

                conn = get_db()
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO heavy_master_distillation
                        (prompt, task_intent, platform, shell, trial_commands, steps_count,
                         masterpiece_command, master_critique, taught_by, latency_saved_est_sec)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id;
                    """, (prompt, task_intent, platform, shell, json.dumps(trial_commands),
                          steps_count, masterpiece_command, master_critique, taught_by, latency_saved))
                    distill_id = cur.fetchone()[0]
                conn.commit()

                strategy_id = record_heavy_masterpiece(
                    conn,
                    task_intent=task_intent,
                    platform=platform,
                    shell=shell,
                    masterpiece_command=masterpiece_command,
                    strategy_summary=data.get('strategy_summary', ''),
                    avoid_patterns=data.get('avoid_patterns', ''),
                    taught_by=taught_by
                )
                conn.close()

                # Telegram notification for heavy masterpiece
                trial_text = "\n".join(
                    f"• <code>{escape_html(str(c))}</code>" for c in trial_commands[:5]
                ) or "Multi-turn trial and error"
                send_telegram(
                    f"👑 <b>HunterStar Heavy Masterpiece</b>\n"
                    f"🎯 <b>Intent:</b> <code>{escape_html(task_intent)}</code> [{escape_html(platform)}/{escape_html(shell)}]\n\n"
                    f"<b>Trial Commands:</b>\n{trial_text}\n\n"
                    f"<b>Masterpiece:</b>\n<pre>{escape_html(masterpiece_command)}</pre>\n\n"
                    f"💡 <b>By:</b> <code>{escape_html(taught_by)}</code> (saved ~{latency_saved:.1f}s)"
                )

                self._send_json(200, {
                    "ok": True,
                    "distill_id": distill_id,
                    "strategy_id": strategy_id,
                    "task_intent": task_intent,
                    "saved_to_postgres": True,
                    "telegram_notified": True
                })
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})

        # ── Legacy teacher endpoints → 410 Gone ──────────────────────────────
        elif path in ['/distill', '/intelect/distill', '/intelect/rule', '/rule',
                      '/intelect/instructions']:
            self._send_json(410, {
                "ok": False,
                "error": "Teacher distillation endpoint removed in v4.0.0."
            })
        else:
            self._send_json(404, {"ok": False, "error": "Not found"})


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), IntelectHandler)
    print(f"Intelect Server v4.0.0 — Teacher removed, baked prompt active")
    print(f"Fast prompt: {FAST_SYSTEM_PROMPT[:80]}...")
    server.serve_forever()
