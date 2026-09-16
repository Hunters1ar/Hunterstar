import os from 'os';
import { execSync } from 'child_process';

/**
 * Detects the current Operating System, Shell, and Command Chaining Syntax
 */
export function detectPlatform() {
    const platform = process.platform;
    let osType = 'linux';
    let osDisplayName = 'Linux';

    if (platform === 'win32') {
        osType = 'windows';
        osDisplayName = 'Windows';
    } else if (platform === 'darwin') {
        osType = 'macos';
        osDisplayName = 'macOS';
    } else if (platform === 'linux') {
        osType = 'linux';
        osDisplayName = 'Linux';
    }

    let shellType = 'bash';
    let shellPath = '/bin/bash';
    let commandSeparator = '&&';

    if (osType === 'windows') {
        const shellEnv = process.env.SHELL || '';
        if (shellEnv.includes('bash') || process.env.MSYSTEM) {
            shellType = 'bash';
            shellPath = shellEnv || 'bash.exe';
            commandSeparator = '&&';
        } else {
            let isPwsh = false;
            try {
                const ppid = process.ppid;
                const cmd = `powershell -NoProfile -Command "(Get-Process -Id ${ppid} -ErrorAction SilentlyContinue).ProcessName"`;
                const parentName = execSync(cmd, { encoding: 'utf8', timeout: 2000 }).trim().toLowerCase();
                if (parentName.includes('pwsh') || parentName.includes('powershell')) {
                    isPwsh = true;
                }
            } catch {
                if (process.env.PSModulePath || process.env.POWERSHELL_DISTRIBUTION_CHANNEL) {
                    isPwsh = true;
                }
            }

            if (isPwsh) {
                shellType = 'powershell';
                shellPath = 'powershell.exe';
                commandSeparator = ';';
            } else {
                shellType = 'cmd';
                shellPath = 'cmd.exe';
                commandSeparator = '&&';
            }
        }
    } else if (osType === 'macos') {
        const shellEnv = process.env.SHELL || '/bin/zsh';
        shellPath = shellEnv;
        if (shellEnv.includes('zsh')) shellType = 'zsh';
        else if (shellEnv.includes('fish')) shellType = 'fish';
        else shellType = 'bash';
        commandSeparator = '&&';
    } else {
        // Linux / Unix
        const shellEnv = process.env.SHELL || '/bin/bash';
        shellPath = shellEnv;
        if (shellEnv.includes('zsh')) shellType = 'zsh';
        else if (shellEnv.includes('fish')) shellType = 'fish';
        else shellType = 'bash';
        commandSeparator = '&&';
    }

    return {
        os: osType,
        osDisplayName,
        osRelease: os.release(),
        shell: shellType,
        shellPath,
        commandSeparator,
        isWindows: osType === 'windows',
        isMac: osType === 'macos',
        isLinux: osType === 'linux'
    };
}

/**
 * Returns detailed execution guidance for the AI assistant tailored to the detected environment
 */
export function getShellGuidance(info) {
    if (info.isWindows) {
        if (info.shell === 'powershell') {
            return `CURRENT ENVIRONMENT:
- Operating System: Windows (win32, release ${info.osRelease})
- Active Shell: PowerShell (${info.shellPath})
- Command Chaining: Use '${info.commandSeparator}' for sequential commands. DO NOT use '&&' because Windows PowerShell 5.1 throws a syntax error on '&&'.
- Path format: Use backslashes '\\' or forward slashes '/'.
- Environment variables: Use '$env:VAR_NAME' (not 'export' or '%VAR%').
- Commands: Use PowerShell or CLI commands. Do not use Linux-only tools like 'touch', 'export', 'grep' (use Select-String).
- NEVER execute 'convert' on Windows (it invokes C:\\Windows\\System32\\convert.exe which is a filesystem FAT-to-NTFS drive tool, NOT ImageMagick).`;
        } else if (info.shell === 'cmd') {
            return `CURRENT ENVIRONMENT:
- Operating System: Windows (win32, release ${info.osRelease})
- Active Shell: Command Prompt (cmd.exe)
- Command Chaining: Use '&&' or '&' (NEVER use ';').
- Environment variables: Use '%VAR_NAME%'.
- NEVER execute 'convert' on Windows.`;
        } else {
            return `CURRENT ENVIRONMENT:
- Operating System: Windows (Git Bash/MSYS)
- Active Shell: Bash (${info.shellPath})
- Command Chaining: Use '&&'.`;
        }
    } else if (info.isMac) {
        return `CURRENT ENVIRONMENT:
- Operating System: macOS (${info.osRelease})
- Active Shell: ${info.shell} (${info.shellPath})
- Command Chaining: Use '&&' (standard Unix).
- Package Manager / Tools: brew, open, curl.
- Environment variables: Use 'export VAR=val' and '$VAR'.`;
    } else {
        return `CURRENT ENVIRONMENT:
- Operating System: Linux (${info.osRelease})
- Active Shell: ${info.shell} (${info.shellPath})
- Command Chaining: Use '&&' (standard Unix, NOT Windows ';').
- Package Manager / Tools: apt, yum, pacman, systemctl, curl, grep, cat.
- Environment variables: Use 'export VAR=val' and '$VAR'.`;
    }
}
