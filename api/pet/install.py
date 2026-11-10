"""Run on Hunterella as root after uploading this directory. Never manages 8080."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import socket
import subprocess
import time
import urllib.request
from proxy import add_pet_route

SOURCE = Path(__file__).resolve().parent
DEST = Path('/opt/portfolio-pet')
CONFIG = Path('/etc/portfolio-pet')
MODEL_UNIT = 'llama-portfolio-pet.service'
API_UNIT = 'portfolio-pet-api.service'
CLI_UNIT = 'llama-hunter.service'
CADDY = Path('/etc/caddy/Caddyfile')


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout.strip()


def service_pid(unit):
    result = subprocess.run(['systemctl', 'show', unit, '-p', 'MainPID', '--value'], text=True, capture_output=True)
    return int(result.stdout.strip() or '0')


def check_port(port, unit):
    with socket.socket() as sock:
        sock.settimeout(1)
        occupied = sock.connect_ex(('127.0.0.1', port)) == 0
    if occupied and not service_pid(unit):
        raise RuntimeError(f'Port {port} already belongs to another process; nothing was changed.')


def wait_ready():
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen('http://127.0.0.1:8091/api/pet/health', timeout=3) as response:
                if json.load(response)['ok']:
                    return
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise RuntimeError('The dedicated model did not become ready. Existing CLI and proxy remain unchanged.')


def install():
    if os.geteuid() != 0:
        raise RuntimeError('Run this installer as root on Hunterella.')
    if run('hostname') != 'hunterella':
        raise RuntimeError('This installer is for Hunterella only.')
    model = Path('/root/models/Hermes-3-Llama-3.1-8B-Q4_K_M.gguf')
    if not model.is_file():
        raise RuntimeError('The Hermes 3 model was not found.')
    check_port(8090, MODEL_UNIT)
    check_port(8091, API_UNIT)
    cli_file = Path('/etc/systemd/system/llama-hunter.service')
    cli_before = (service_pid(CLI_UNIT), hashlib.sha256(cli_file.read_bytes()).hexdigest())
    old_proxy = CADDY.read_text()
    new_proxy = add_pet_route(old_proxy)
    print(f'CLI on 8080 recorded: PID {cli_before[0]}. Installing separate pet services.', flush=True)

    try:
        account = pwd.getpwnam('portfolio-pet')
    except KeyError:
        run('useradd', '--system', '--no-create-home', '--shell', '/usr/sbin/nologin', 'portfolio-pet')
        account = pwd.getpwnam('portfolio-pet')
    DEST.mkdir(mode=0o755, exist_ok=True)
    CONFIG.mkdir(mode=0o750, exist_ok=True)
    os.chown(CONFIG, 0, account.pw_gid)
    key_file = CONFIG / 'model.key'
    if not key_file.exists():
        key_file.write_text(secrets.token_urlsafe(48) + '\n')
    os.chown(key_file, 0, account.pw_gid)
    key_file.chmod(0o640)

    shutil.copyfile(SOURCE / 'server.py', DEST / 'server.py')
    (DEST / 'server.py').chmod(0o644)
    for unit in (MODEL_UNIT, API_UNIT):
        target = Path('/etc/systemd/system') / unit
        data = (SOURCE / unit).read_bytes()
        changed = not target.exists() or target.read_bytes() != data
        target.write_bytes(data)
        target.chmod(0o644)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'enable', unit)
        run('systemctl', 'restart' if changed or unit == API_UNIT else 'start', unit)
    print('New services started. Waiting for Hermes 3 on 8090…', flush=True)
    wait_ready()

    # Validate the complete config without printing its existing credentials.
    staging = CONFIG / 'Caddyfile.staged'
    staging.write_text(new_proxy)
    staging.chmod(0o600)
    run('caddy', 'validate', '--config', str(staging), '--adapter', 'caddyfile')
    backup = CONFIG / ('Caddyfile.backup-' + str(int(time.time())))
    backup.write_text(old_proxy)
    backup.chmod(0o600)
    try:
        CADDY.write_text(new_proxy)
        run('systemctl', 'reload', 'caddy')
    except Exception:
        CADDY.write_text(old_proxy)
        run('systemctl', 'reload', 'caddy')
        raise

    cli_after = (service_pid(CLI_UNIT), hashlib.sha256(cli_file.read_bytes()).hexdigest())
    if cli_after != cli_before:
        raise RuntimeError('The CLI changed during deployment; investigate concurrent changes.')
    print(json.dumps({'ok': True, 'modelPort': 8090, 'apiPort': 8091,
                      'endpoint': 'https://image.hunterstar.uz/api/pet/chat',
                      'cliPidBefore': cli_before[0], 'cliPidAfter': cli_after[0], 'cliConfigUnchanged': True}), flush=True)


if __name__ == '__main__':
    install()
