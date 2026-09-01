import inquirer from 'inquirer';
import { startAiChat } from './ai.js';
import { runDoctor } from './doctor.js';
import { runServerCommand } from './server/index.js';
import { runSync } from './sync.js';
import { runUpdate } from './update.js';

export async function showDashboard() {
    const logo = `
  ___ ___               __                         __                
 /   |   \\ __ __  _____/  |_  ___________  _______/  |______ _______ 
/    ~    \\  |  \\/    \\   __\\/ __ \\_  __ \\/  ___/\\   __\\__  \\\\_  __ \\
\\    Y    /  |  /   |  \\  | \\  ___/|  | \\/\\___ \\  |  |  / __ \\|  | \\/
 \\___|_  /|____/|___|  /__|  \\___  >__|  /____  > |__| (____  /__|   
       \\/            \\/          \\/           \\/            \\/       
`;

    while (true) {
        console.clear();
        console.log('\x1b[36m' + logo + '\x1b[0m');
        console.log('\x1b[36m' + '='.repeat(70) + '\x1b[0m\n');

        const { action } = await inquirer.prompt([
            {
                type: 'select',
                name: 'action',
                message: 'What would you like to do?',
                choices: [
                    { name: '\uD83D\uDD0C Run frontend/backend servers', value: 'server' },
                    { name: '\uD83E\uDD16 Start AI Assistant', value: 'ai' },
                    { name: '\uD83D\uDCE4 One-Command Git Sync', value: 'sync' },
                    { name: '\uD83E\uDE7A System Health Check (Doctor)', value: 'doctor' },
                    { name: '\u2B06\uFE0F  Update Hunterstar CLI', value: 'update' },
                    new inquirer.Separator(),
                    { name: '\u274C Exit', value: 'exit' }
                ],
                pageSize: 10
            }
        ]);

        switch (action) {
            case 'server':
                await runServerCommand([]);
                break;
            case 'ai':
                await startAiChat({ turbo: true });
                break;
            case 'sync':
                await runSync([]);
                break;
            case 'doctor':
                await runDoctor();
                break;
            case 'update':
                await runUpdate();
                break;
            case 'exit':
                console.log('\x1b[32mGoodbye!\x1b[0m');
                process.exit(0);
                return;
        }
        
        console.log();
        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to return to menu...' }]);
    }
}
