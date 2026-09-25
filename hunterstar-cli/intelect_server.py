#!/usr/bin/env python3
import json
import os
import sys
import urllib.request
from urllib.parse import urlparse, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler
import psycopg2
from psycopg2.extras import RealDictCursor

PORT = 8083
DATASET_FILE = '/root/models/intelect/dataset.jsonl'
TELEGRAM_BOT_TOKEN = os.environ.get('ANALYTICS_BOT', '8731326573:AAGg9_VdlGc_5IaqNXJgNvHx8--1IgQH3Ks')
TELEGRAM_CHAT_ID = os.environ.get('ANALYTICS_CHAT_ID', '8950733976')

def get_db():
    return psycopg2.connect("dbname=intelect user=root")

def send_telegram_teaching_report(session_user, prompt, before, mistake, what_taught, what_to_expect, score=None):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        def escape_html(s):
            if not s:
                return ""
            return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

        lessons = []
        if isinstance(what_taught, list):
            lessons = what_taught
        elif isinstance(what_taught, str) and what_taught.strip():
            lessons = [l.strip().lstrip("-*• ") for l in what_taught.split("\n") if l.strip()]
        if not lessons:
            lessons = ["Role separation and dynamic session identity alignment."]

        lessons_html = "\n".join(f"• {escape_html(l)}" for l in lessons)
        score_badge = f" (Score: <b>{score}/10</b>)" if score else ""

        text = (
            f"🧠 <b>Hunterstar AI Teaching Report</b>{score_badge}\n"
            f"👤 <b>Session User:</b> <code>{escape_html(session_user)}</code>\n"
            f"🎯 <b>Prompt:</b> <code>{escape_html(prompt)}</code>\n\n"
            f"<b>Before:</b>\n<pre>{escape_html(before or 'No previous answer')}</pre>\n\n"
            f"<b>What was the mistake:</b>\n{escape_html(mistake or 'Suboptimal or confused output.')}\n\n"
            f"<b>What taught:</b>\n{lessons_html}\n\n"
            f"<b>What to expect:</b>\n<pre>{escape_html(what_to_expect or 'Target response')}</pre>"
        )

        payload = json.dumps({"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"}).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        print("[Analytics] Failed to send Telegram teaching report:", e)

def send_telegram_heavy_master_report(task_intent, platform, shell, trial_commands, masterpiece_command, critique, taught_by, latency_saved=0.0):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        def escape_html(s):
            if not s:
                return ""
            return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

        trial_text = ""
        if isinstance(trial_commands, list) and trial_commands:
            trial_text = "\n".join(f"• <code>{escape_html(str(c))}</code>" for c in trial_commands[:5])
        elif trial_commands:
            trial_text = f"<pre>{escape_html(str(trial_commands))}</pre>"
        else:
            trial_text = "Multi-turn trial and error exploratory commands"

        text = (
            f"👑 <b>Hunterstar Heavy Masterpiece Upgrade</b>\n"
            f"🎯 <b>Task Intent:</b> <code>{escape_html(task_intent)}</code> [{escape_html(platform)} / {escape_html(shell)}]\n\n"
            f"<b>Trial & Error Run (Before):</b>\n{trial_text}\n\n"
            f"<b>Master Critique:</b>\n{escape_html(critique or 'Eliminated exploratory loops with 1-shot masterpiece command.')}\n\n"
            f"<b>⚡ Masterpiece Command (1-Shot):</b>\n<pre>{escape_html(masterpiece_command)}</pre>\n\n"
            f"🎓 <b>Taught By:</b> <code>{escape_html(taught_by or 'cloud-master')}</code> (Saved ~{latency_saved:.1f}s)"
        )

        payload = json.dumps({"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"}).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        print("[Analytics] Failed to send Telegram heavy master report:", e)

def record_knowledge_rule(conn, scope, rule_text, weight=1):
    if not rule_text or not rule_text.strip():
        return None
    scope = (scope or 'global').strip()
    rule_text = rule_text.strip()
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, weight FROM knowledge_rules
            WHERE LOWER(scope) = LOWER(%s) AND rule_text = %s
            LIMIT 1;
        """, (scope, rule_text))
        row = cur.fetchone()
        if row:
            rule_id = row[0]
            new_weight = row[1] + 1
            cur.execute("""
                UPDATE knowledge_rules
                SET weight = %s, created_at = CURRENT_TIMESTAMP
                WHERE id = %s RETURNING id;
            """, (new_weight, rule_id))
            ret_id = cur.fetchone()[0]
        else:
            cur.execute("""
                INSERT INTO knowledge_rules (scope, rule_text, weight, created_at)
                VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                RETURNING id;
            """, (scope, rule_text, weight))
            ret_id = cur.fetchone()[0]
    conn.commit()
    return ret_id

def record_heavy_masterpiece(conn, task_intent, platform, shell, masterpiece_command, strategy_summary='', avoid_patterns='', taught_by='cloud-master', weight=10):
    if not task_intent or not masterpiece_command:
        return None
    task_intent = task_intent.strip()
    platform = (platform or 'all').strip().lower()
    shell = (shell or 'all').strip().lower()
    masterpiece_command = masterpiece_command.strip()

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO heavy_master_strategies (task_intent, platform, shell, masterpiece_command, strategy_summary, avoid_patterns, taught_by, weight, success_count, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 1, CURRENT_TIMESTAMP)
            ON CONFLICT (task_intent, platform, shell)
            DO UPDATE SET
                masterpiece_command = EXCLUDED.masterpiece_command,
                strategy_summary = COALESCE(NULLIF(EXCLUDED.strategy_summary, ''), heavy_master_strategies.strategy_summary),
                avoid_patterns = COALESCE(NULLIF(EXCLUDED.avoid_patterns, ''), heavy_master_strategies.avoid_patterns),
                taught_by = EXCLUDED.taught_by,
                weight = heavy_master_strategies.weight + 2,
                success_count = heavy_master_strategies.success_count + 1,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id;
        """, (task_intent, platform, shell, masterpiece_command, strategy_summary, avoid_patterns, taught_by, weight))
        ret_id = cur.fetchone()[0]
    conn.commit()
    return ret_id

class IntelectHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, default=str).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path in ['/stats', '/intelect/stats', '/api/intelect/stats']:
            try:
                conn = get_db()
                with conn.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM teacher_distillation")
                    distill_count = cur.fetchone()[0]
                    cur.execute("SELECT COUNT(*) FROM knowledge_rules")
                    rules_count = cur.fetchone()[0]
                    cur.execute("SELECT COUNT(*) FROM heavy_master_strategies")
                    strategies_count = cur.fetchone()[0]
                    cur.execute("""
                        SELECT "session_user", prompt, teacher_critique, ideal_response, score, lesson_taught, created_at
                        FROM teacher_distillation ORDER BY id DESC LIMIT 5
                    """)
                    recent = [{
                        "session_user": r[0], "prompt": r[1], "critique": r[2],
                        "ideal_response": r[3], "score": r[4], "lesson": r[5],
                        "created_at": str(r[6])
                    } for r in cur.fetchall()]
                conn.close()
                self._send_json(200, {
                    "ok": True,
                    "distillations": distill_count,
                    "knowledge_rules": rules_count,
                    "masterpiece_strategies": strategies_count,
                    "recent": recent
                })
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})

        elif path in ['/instructions', '/intelect/instructions', '/api/intelect/instructions']:
            username = qs.get('username', [None])[0] or qs.get('userId', [None])[0] or 'guest'
            try:
                conn = get_db()
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT id, scope AS username, rule_text AS instruction, weight AS confidence_score, created_at AS updated_at
                        FROM knowledge_rules
                        WHERE LOWER(scope) = LOWER(%s) OR scope = 'global'
                        ORDER BY weight DESC, created_at DESC;
                    """, (username,))
                    instructions = cur.fetchall()

                conn.close()
                self._send_json(200, {
                    "ok": True,
                    "session_user": username,
                    "instructions": instructions
                })
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})

        elif path in ['/heavy/strategies', '/intelect/heavy/strategies', '/api/intelect/heavy/strategies']:
            intent = qs.get('intent', [None])[0] or qs.get('task_intent', [None])[0]
            platform = (qs.get('platform', [None])[0] or '').lower()
            shell = (qs.get('shell', [None])[0] or '').lower()
            try:
                conn = get_db()
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute("""
                        SELECT id, task_intent, platform, shell, masterpiece_command, strategy_summary, avoid_patterns, taught_by, weight, success_count
                        FROM active_heavy_strategies
                        WHERE (%s IS NULL OR LOWER(task_intent) = LOWER(%s))
                          AND (%s = '' OR LOWER(platform) = %s OR platform = 'all')
                          AND (%s = '' OR LOWER(shell) = %s OR shell = 'all')
                        ORDER BY weight DESC;
                    """, (intent, intent, platform, platform, shell, shell))
                    strategies = cur.fetchall()
                conn.close()
                self._send_json(200, {
                    "ok": True,
                    "count": len(strategies),
                    "strategies": strategies
                })
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})

        else:
            self._send_json(200, {"ok": True, "service": "Hunterstar Intelect Dataset API", "version": "3.0.0"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ['/distill', '/intelect/distill', '/api/intelect/distill']:
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                raw_body = self.rfile.read(content_len).decode('utf-8')
                data = json.loads(raw_body)

                session_user = data.get('session_user') or data.get('username') or data.get('userId') or 'guest'
                prompt = data.get('prompt', '')
                student_output = data.get('student_output') or data.get('fast_response', '')
                teacher_critique = data.get('teacher_critique', '')
                ideal_response = data.get('ideal_response', '')
                score = data.get('score') or data.get('quality_score') or 5
                try:
                    score = int(score)
                except Exception:
                    score = 5

                lesson_taught = data.get('lesson_taught') or data.get('lesson') or None
                user_context = data.get('user_context', {})

                conn = get_db()

                # 1. Insert into teacher_distillation
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO teacher_distillation
                        ("session_user", prompt, student_output, fast_response, teacher_critique, ideal_response, lesson_taught, score, quality_score, user_context)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id;
                    """, (
                        session_user, prompt, student_output, student_output,
                        teacher_critique, ideal_response, lesson_taught, score, score,
                        json.dumps(user_context)
                    ))
                    sample_id = cur.fetchone()[0]
                conn.commit()

                # 2. Record rule in knowledge_rules if lesson is present
                rule_id = None
                if lesson_taught and str(lesson_taught).strip():
                    rule_id = record_knowledge_rule(conn, scope=session_user, rule_text=str(lesson_taught).strip(), weight=1)

                conn.close()

                # 3. Dynamic ShareGPT formatted dataset export
                dataset_entry = {
                    "id": sample_id,
                    "session_user": session_user,
                    "score": score,
                    "critique": teacher_critique,
                    "lesson": lesson_taught,
                    "messages": [
                        {"role": "system", "content": "You are HunterStar AI talking to {{user}}."},
                        {"role": "user", "content": prompt},
                        {"role": "assistant", "content": ideal_response.replace(session_user, "{{user}}")}
                    ]
                }
                with open(DATASET_FILE, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(dataset_entry, ensure_ascii=False) + '\n')

                # 4. Notify Telegram Analytics Bot
                send_telegram_teaching_report(
                    session_user=session_user,
                    prompt=prompt,
                    before=student_output,
                    mistake=teacher_critique,
                    what_taught=lesson_taught or "Session identity and behavioral alignment.",
                    what_to_expect=ideal_response,
                    score=score
                )

                self._send_json(200, {
                    "ok": True,
                    "id": sample_id,
                    "rule_id": rule_id,
                    "session_user": session_user,
                    "saved_to_postgres": True,
                    "saved_to_jsonl": True,
                    "telegram_notified": True
                })
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})

        elif path in ['/heavy/distill', '/intelect/heavy/distill', '/api/intelect/heavy/distill']:
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
                # 1. Insert into heavy_master_distillation log
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO heavy_master_distillation
                        (prompt, task_intent, platform, shell, trial_commands, steps_count, masterpiece_command, master_critique, taught_by, latency_saved_est_sec)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id;
                    """, (prompt, task_intent, platform, shell, json.dumps(trial_commands), steps_count, masterpiece_command, master_critique, taught_by, latency_saved))
                    distill_id = cur.fetchone()[0]
                conn.commit()

                # 2. Record or update masterpiece strategy
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

                # 3. Notify Telegram Analytics Bot
                send_telegram_heavy_master_report(
                    task_intent=task_intent,
                    platform=platform,
                    shell=shell,
                    trial_commands=trial_commands,
                    masterpiece_command=masterpiece_command,
                    critique=master_critique,
                    taught_by=taught_by,
                    latency_saved=latency_saved
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

        elif path in ['/instruction', '/intelect/instruction', '/api/intelect/instruction', '/rule', '/intelect/rule']:
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                raw_body = self.rfile.read(content_len).decode('utf-8')
                data = json.loads(raw_body)
                scope = data.get('scope') or data.get('session_user') or data.get('username') or 'global'
                rule_text = data.get('rule_text') or data.get('instruction') or ''
                weight = int(data.get('weight', 1))

                conn = get_db()
                rule_id = record_knowledge_rule(conn, scope=scope, rule_text=rule_text, weight=weight)
                conn.close()
                self._send_json(200, {"ok": True, "id": rule_id, "scope": scope})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
        else:
            self._send_json(404, {"ok": False, "error": "Not found"})

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), IntelectHandler)
    print(f"Intelect Server v3.0.0 running on http://127.0.0.1:{PORT}")
    server.serve_forever()
