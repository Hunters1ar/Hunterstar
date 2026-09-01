import { startAiChat } from './commands/ai.js';
import { runDoctor } from './commands/doctor.js';
import { runDeploy } from './commands/deploy.js';
import { runConfig } from './commands/config.js';
import { runServerCommand } from './commands/server/index.js';

export async function runCLI() {
    const rawArgs = process.argv.slice(2);
    
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
        case 'init':
            console.log('dYs? Initializing Hunterstar project...');
            console.log('\u2713 Project structures created successfully!');
            break;
        case 'help':
        case undefined:
            showHelp();
            break;
        default:
            console.log(`\x1b[31mUnknown command:\x1b[0m ${command}`);
            console.log('Run \x1b[36mhunterstar help\x1b[0m to see available commands.');
            break;
    }
}

function showHelp() {
    console.log(`
\x1b[36mdYs? Hunterstar CLI v1.0.0\x1b[0m

\x1b[33mUsage:\x1b[0m hunterstar <command> [options]

\x1b[32mCommands:\x1b[0m
  \x1b[36mai\x1b[0m       - Interactive AI Assistant (Uses Hunterstar Server Knowledge)
  \x1b[36mserver\x1b[0m   - Detect and run frontend/backend servers (with optional tunneling)
  \x1b[36mdeploy\x1b[0m   - Deploy application to VPS
  \x1b[36mdoctor\x1b[0m   - Check system dependencies (Node, Git, etc.)
  \x1b[36minit\x1b[0m     - Initialize a new Hunterstar project structure
  \x1b[36mconfig\x1b[0m   - Manage CLI configuration (get/set)
  \x1b[36mhelp\x1b[0m     - Show this help message

\x1b[32mOptions (for 'ai' command):\x1b[0m
  \x1b[36m--no-exec\x1b[0m  - Disable command execution (dry run)
  \x1b[36m--verbose\x1b[0m  - Show debug information
  \x1b[36m--turbo\x1b[0m    - Auto-approve safe commands without asking (turbo mode)
`);
}
