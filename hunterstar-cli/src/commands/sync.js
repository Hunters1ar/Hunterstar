import { exec } from 'child_process';
import util from 'util';
import inquirer from 'inquirer';

const execPromise = util.promisify(exec);

export async function runSync(args) {
    let commitMessage = args.join(' ');
    
    if (!commitMessage) {
        const { msg } = await inquirer.prompt([{
            type: 'input',
            name: 'msg',
            message: 'Enter commit message:'
        }]);
        commitMessage = msg;
    }
    
    if (!commitMessage.trim()) {
        console.log('\x1b[31mCommit message cannot be empty.\x1b[0m');
        return;
    }

    try {
        console.log('\n\x1b[36m[1/3] Adding all files to git...\x1b[0m');
        await execPromise('git add .');
        
        console.log(`\x1b[36m[2/3] Committing as: "${commitMessage}"...\x1b[0m`);
        try {
            await execPromise(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`);
        } catch (e) {
            const out = (e.stdout || '') + (e.stderr || '');
            if (out.includes('nothing to commit') || out.includes('no changes added to commit') || out.includes('working tree clean')) {
                console.log('\x1b[33mNo changes to commit.\x1b[0m');
            } else {
                throw e;
            }
        }

        console.log('\x1b[36m[3/3] Preparing to push...\x1b[0m');

        // Check if multiple accounts issue needs a local username
        try {
            const { stdout: localUser } = await execPromise('git config --local credential.username');
            if (!localUser.trim()) {
                throw new Error('Not set');
            }
            console.log(`\x1b[90m(Using local git credential.username: ${localUser.trim()})\x1b[0m`);
        } catch {
            // Not set, let's ask if they want to set it
            const { setUsername } = await inquirer.prompt([{
                type: 'confirm',
                name: 'setUsername',
                message: 'Do you want to set a specific git username for this repo to avoid account conflicts?',
                default: false
            }]);
            
            if (setUsername) {
                const { user } = await inquirer.prompt([{
                    type: 'input',
                    name: 'user',
                    message: 'Enter your git username:'
                }]);
                
                if (user.trim()) {
                    await execPromise(`git config --local credential.username "${user.trim()}"`);
                    console.log(`\x1b[32m\u2713 Set local credential.username to ${user.trim()}\x1b[0m`);
                }
            }
        }
        
        console.log('\x1b[36mPushing to remote...\x1b[0m');
        const { stdout, stderr } = await execPromise('git push');
        if (stdout) console.log(stdout.trim());
        if (stderr && !stderr.includes('Everything up-to-date')) console.log(stderr.trim());
        
        console.log('\n\x1b[32m\u2728 Sync complete! Code successfully pushed.\x1b[0m');
    } catch (error) {
        console.log('\n\x1b[31m\u2717 Sync failed:\x1b[0m', error.message);
    }
}
