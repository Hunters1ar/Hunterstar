import inquirer from 'inquirer';
import { startAiChat } from './ai.js';
import { runDoctor } from './doctor.js';
import { runServerCommand } from './server/index.js';
import { runGit } from './git.js';
import { runUpdate } from './update.js';
import { HUNTERSTAR_LOGO, playLogoSpin } from '../spinner.js';

export async function showDashboard() {
    let isFirstLoad = true;

    while (true) {
        console.clear();

        if (isFirstLoad) {
            await playLogoSpin('HunterStar CLI  v2.0.0', 1, 40);
            isFirstLoad = false;
        } else {
            console.log(`\x1b[36m${HUNTERSTAR_LOGO}\x1b[0m \x1b[1mHunterStar CLI\x1b[0m \x1b[35mv2.0.0\x1b[0m`);
        }

        console.log('\x1b[36m' + '─'.repeat(55) + '\x1b[0m');
        console.log(`\x1b[90mModern Full-Stack & AI Assistant Platform\x1b[0m\n`);

        const { action } = await inquirer.prompt([
            {
                type: 'select',
                name: 'action',
                message: 'What would you like to do?',
                choices: [
                    { name: '\uD83E\uDD16 Start AI Assistant', value: 'ai' },
                    { name: '\uD83D\uDD0C Run frontend/backend servers', value: 'server' },
                    { name: '\uD83D\uDE80 Deploy', value: 'deploy' },
                    { name: '\uD83E\uDE7A System Health Check (Doctor)', value: 'doctor' },
                    { name: '\u2B06\uFE0F  Update Hunterstar CLI', value: 'update' },
                    new inquirer.Separator(),
                    { name: '\u274C Exit', value: 'exit' }
                ],
                pageSize: 10
            }
        ]);

        switch (action) {
            case 'ai':
                await startAiChat({ turbo: true });
                break;
            case 'server':
                await runServerCommand([]);
                break;
            case 'deploy':
            case 'sync':
                await runGit([]);
                break;
            case 'doctor':
                await runDoctor();
                break;
            case 'update':
                await runUpdate();
                break;
            case 'exit':
                console.log(`\n\x1b[32m${HUNTERSTAR_LOGO} Goodbye!\x1b[0m\n`);
                process.exit(0);
                return;
        }
        
        console.log();
        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to return to menu...' }]);
    }
}
