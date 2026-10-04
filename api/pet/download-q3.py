"""Download an additional, checksum-pinned GGUF for the portfolio only."""
import hashlib
import json
from pathlib import Path
import subprocess

NAME = 'Hermes-3-Llama-3.1-8B-Q3_K_M.gguf'
URL = 'https://huggingface.co/bartowski/Hermes-3-Llama-3.1-8B-GGUF/resolve/main/' + NAME
SHA256 = '12b39e5ec1ddbfab901849c7f4ffad6abfe50de5987b718e91d0c6937abaffc3'


def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


target = Path('/root/models') / NAME
if target.exists():
    if digest(target) != SHA256:
        raise RuntimeError('An existing Q3 model has a different checksum; it was not changed.')
else:
    partial = target.with_suffix('.gguf.part')
    print('Downloading the separate portfolio Q3_K_M model from its quantization publisher…', flush=True)
    subprocess.run(['curl', '-fsSL', '--retry', '3', '--connect-timeout', '20',
                    '--continue-at', '-', '--output', str(partial), URL], check=True)
    if digest(partial) != SHA256:
        raise RuntimeError('Q3 model checksum failed. The CLI model was not changed.')
    partial.rename(target)
print(json.dumps({'ok': True, 'file': str(target), 'bytes': target.stat().st_size, 'sha256': SHA256}), flush=True)
