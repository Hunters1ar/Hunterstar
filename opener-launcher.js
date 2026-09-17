'use strict';
// Compatibility entry point: the C# app now owns Firebase and Chrome launching.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const root = path.join(__dirname, 'opener-desktop');
const output = path.join(root, 'publish');
const exe = path.join(output, 'Hunterstar.Opener.exe');

function newestSource(directory) {
  let newest = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['bin', 'obj', 'publish'].includes(entry.name) || entry.name.endsWith('.user')) continue;
    const file = path.join(directory, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestSource(file) : fs.statSync(file).mtimeMs);
  }
  return newest;
}

if (process.platform !== 'win32') {
  console.error('Hunterstar Account Opener requires Windows.');
  process.exit(1);
}
if (!fs.existsSync(exe) || newestSource(root) > fs.statSync(exe).mtimeMs) {
  console.log('Building the local C# Account Opener...');
  const build = spawnSync('dotnet', ['publish', root, '-c', 'Release', '-o', output, '--self-contained', 'false'], {
    stdio: 'inherit', windowsHide: true
  });
  if (build.error || build.status !== 0) {
    console.error('Build failed. Install the .NET 10 SDK; close Account Opener if a previous copy is running.');
    process.exit(1);
  }
  // Content-only changes may not cause MSBuild to rewrite the executable.
  const now = new Date();
  fs.utimesSync(exe, now, now);
}
const child = spawn(exe, process.argv.slice(2), {
  cwd: output, detached: true, stdio: 'ignore', windowsHide: false
});
child.once('error', error => {
  console.error('Could not open Account Opener:', error.message);
  process.exitCode = 1;
});
child.once('spawn', () => {
  child.unref();
  console.log('Opened Hunterstar Account Opener. You can close this terminal.');
});
