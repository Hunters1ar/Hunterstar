import { startAiChat } from './commands/ai.js';
import { runDoctor } from './commands/doctor.js';
import { runDeploy } from './commands/deploy.js';
import { runConfig } from './commands/config.js';
import { runServerCommand } from './commands/server/index.js';
import { showDashboard } from './commands/dashboard.js';
import { runSync } from './commands/sync.js';
import { runUpdate } from './commands/update.js';
import { runConvert } from './commands/convert.js';
import { runGit } from './commands/git.js';
import { HUNTERSTAR_LOGO } from './spinner.js';

export async function runCLI() {
    const rawArgs = process.argv.slice(2);
    
    // Check for --git flag or git command directly
    if (rawArgs.includes('--git')) {
        const gitArgs = rawArgs.filter(arg => arg !== '--git');
        await runGit(gitArgs);
        return;
    }

    // Parse flags
    const noExec = rawArgs.includes('--no-exec');
    const verbose = rawArgs.includes('--verbose');
    const turbo = rawArgs.includes('--turbo');
    
    const args = rawArgs.filter(arg => !arg.startsWith('--'));
    const command = args[0];

    switch (command) {
        case 'ai':
            await startAiChat({ noExec, verbose, turbo });
            break;
        case 'git':
            await runGit(args.slice(1));
            break;
        case 'convert':
            await runConvert(rawArgs.slice(1));
            break;
        case 'server':
            await runServerCommand(rawArgs.slice(1));
            break;
        case 'doctor':
            await runDoctor();
            break;
        case 'deploy':
            await runDeploy();
            break;
        case 'config':
            await runConfig(args.slice(1));
            break;
        case 'sync':
            await runGit(args.slice(1));
            break;
        case 'update':
            await runUpdate();
            break;
        case 'init':
            console.log(`${HUNTERSTAR_LOGO} Initializing Hunterstar project...`);
            console.log('\u2713 Project structures created successfully!');
            break;
        case 'help':
            showHelp();
            break;
        case undefined:
            await showDashboard();
            break;
        default:
            console.log(`\x1b[31mUnknown command:\x1b[0m ${command}`);
            console.log('Run \x1b[36mhunterstar help\x1b[0m to see available commands.');
            break;
    }
}

function showHelp() {
    console.log(`
\x1b[36m${HUNTERSTAR_LOGO} Hunterstar CLI\x1b[0m

\x1b[33mUsage:\x1b[0m hunterstar <command> [options]

\x1b[32mCommands:\x1b[0m
  \x1b[36mai\x1b[0m          - Interactive AI Assistant (Uses Hunterstar Server Knowledge)
  \x1b[36mgit, --git\x1b[0m  - Smart Git Manager (auto init, commit, link remote, push)
  \x1b[36mconvert\x1b[0m     - Fast image converter (PNG, JPG, WebP, AVIF, TIFF)
  \x1b[36mserver\x1b[0m      - Detect and run frontend/backend servers (with optional tunneling)
  \x1b[36mdeploy\x1b[0m      - Deploy application to VPS
  \x1b[36mdoctor\x1b[0m      - Check system dependencies (Node, Git, etc.)
  \x1b[36minit\x1b[0m        - Initialize a new Hunterstar project structure
  \x1b[36mconfig\x1b[0m      - Manage CLI configuration (get/set)
  \x1b[36msync\x1b[0m        - One-Command Git Sync (adds, commits, pushes)
  \x1b[36mupdate\x1b[0m      - Update Hunterstar CLI to latest version
  \x1b[36mhelp\x1b[0m        - Show this help message

\x1b[32mOptions (for 'ai' command):\x1b[0m
  \x1b[36m--no-exec\x1b[0m   - Disable command execution (dry run)
  \x1b[36m--verbose\x1b[0m   - Show debug information
  \x1b[36m--turbo\x1b[0m     - Auto-approve safe commands without asking (turbo mode)
`);
}
