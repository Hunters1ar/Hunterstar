import { exec } from 'child_process';
import util from 'util';
import inquirer from 'inquirer';
import { createSpinner } from '../spinner.js';
import chalk from 'chalk';
import { detectPlatform } from '../utils/platform.js';

const execPromise = util.promisify(exec);

async function runCmd(cmd, options = {}) {
    const platform = detectPlatform();
    try {
        const { stdout, stderr } = await execPromise(cmd, { cwd: process.cwd(), shell: platform.shellPath, ...options });
        return { success: true, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() };
    } catch (error) {
        return {
            success: false,
            stdout: (error.stdout || '').trim(),
            stderr: (error.stderr || '').trim(),
            message: error.message
        };
    }
}

export async function runGit(args = []) {
    const platform = detectPlatform();
    console.log(chalk.cyan('\n🚀 Hunterstar Git Manager'));
    console.log(chalk.gray(`[System: ${platform.osDisplayName} | Shell: ${platform.shell}]\n`));

    // Custom commit message if provided in arguments
    const customMessage = args.filter(a => !a.startsWith('--')).join(' ').trim();

    // 1. Check if Git is installed
    const gitCheck = await runCmd('git --version');
    if (!gitCheck.success) {
        console.log(chalk.red('❌ Git is not installed or not available in your PATH.'));
        return;
    }

    // 2. Check if inside a git repository
    const repoCheck = await runCmd('git rev-parse --is-inside-work-tree');
    const isRepo = repoCheck.success && repoCheck.stdout === 'true';

    let remoteExists = false;

    if (isRepo) {
        const remoteCheck = await runCmd('git remote -v');
        if (remoteCheck.success && remoteCheck.stdout.length > 0) {
            remoteExists = true;
        }
    }

    // --- SCENARIO 1: EXISTING REPOSITORY WITH REMOTE ---
    if (isRepo && remoteExists) {
        const commitMsg = customMessage || 'hunterstar-cli';

        const spinner = createSpinner('Staging all changes (git add .)...').start();
        const addRes = await runCmd('git add .');
        if (!addRes.success) {
            spinner.fail(chalk.red(`Failed to stage files: ${addRes.stderr || addRes.message}`));
            return;
        }

        spinner.text = `Committing changes: "${commitMsg}"...`;
        const commitRes = await runCmd(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
        if (!commitRes.success) {
            const out = commitRes.stdout + ' ' + commitRes.stderr;
            if (out.includes('nothing to commit') || out.includes('working tree clean')) {
                spinner.info(chalk.yellow('No changes to commit (working tree clean).'));
            } else {
                spinner.fail(chalk.red(`Commit failed: ${commitRes.stderr || commitRes.message}`));
                return;
            }
        } else {
            spinner.succeed(chalk.green(`Committed: "${commitMsg}"`));
        }

        const pushSpinner = createSpinner('Pushing changes to remote (git push)...').start();
        const pushRes = await runCmd('git push');
        if (pushRes.success) {
            pushSpinner.succeed(chalk.green('Successfully pushed to remote!'));
            console.log(chalk.green('\n✨ Git sync complete!\n'));
        } else {
            // Handle if branch has no upstream set
            if (pushRes.stderr.includes('has no upstream branch')) {
                pushSpinner.text = 'Setting upstream and pushing...';
                const branchRes = await runCmd('git branch --show-current');
                const branch = branchRes.stdout || 'main';
                const setUpstream = await runCmd(`git push -u origin ${branch}`);
                if (setUpstream.success) {
                    pushSpinner.succeed(chalk.green(`Pushed and set upstream to origin/${branch}!`));
                    console.log(chalk.green('\n✨ Git sync complete!\n'));
                    return;
                }
            }
            pushSpinner.fail(chalk.red(`Push failed:\n${pushRes.stderr || pushRes.message}\n`));
        }
        return;
    }

    // --- SCENARIO 2: FRESH INSTALLATION / SETUP ---
    console.log(chalk.yellow('📦 Initializing repository setup...\n'));

    // Step 1: git init
    if (!isRepo) {
        const initSpinner = createSpinner('Initializing git repository (git init)...').start();
        const initRes = await runCmd('git init');
        if (!initRes.success) {
            initSpinner.fail(chalk.red(`git init failed: ${initRes.stderr || initRes.message}`));
            return;
        }
        initSpinner.succeed(chalk.green('Initialized empty Git repository.'));
    }

    // Step 2: git add .
    const addSpinner = createSpinner('Staging all files (git add .)...').start();
    const addRes = await runCmd('git add .');
    if (!addRes.success) {
        addSpinner.fail(chalk.red(`git add . failed: ${addRes.stderr || addRes.message}`));
        return;
    }
    addSpinner.succeed(chalk.green('Files staged.'));

    // Step 3: git commit -m "hunter-cli"
    const commitMsg = customMessage || 'hunter-cli';
    const commitSpinner = createSpinner(`Committing as "${commitMsg}"...`).start();
    const commitRes = await runCmd(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`);
    if (!commitRes.success) {
        const out = commitRes.stdout + ' ' + commitRes.stderr;
        if (out.includes('nothing to commit') || out.includes('working tree clean')) {
            commitSpinner.info(chalk.yellow('Nothing to commit.'));
        } else {
            commitSpinner.fail(chalk.red(`Commit failed: ${commitRes.stderr || commitRes.message}`));
            return;
        }
    } else {
        commitSpinner.succeed(chalk.green(`Committed with message: "${commitMsg}".`));
    }

    // Step 4: git branch -M main
    const branchSpinner = createSpinner('Setting main branch (git branch -M main)...').start();
    const branchRes = await runCmd('git branch -M main');
    if (branchRes.success) {
        branchSpinner.succeed(chalk.green('Branch set to main.'));
    } else {
        branchSpinner.warn(chalk.yellow('Could not rename branch to main, continuing...'));
    }

    // Step 5: Prompt for GitHub repository link
    if (!remoteExists) {
        console.log();
        const { repoLink } = await inquirer.prompt([{
            type: 'input',
            name: 'repoLink',
            message: chalk.cyan('Please enter your GitHub repository link:'),
            validate: (input) => {
                if (!input.trim()) return 'Repository link cannot be empty.';
                return true;
            }
        }]);

        const remoteAddSpinner = createSpinner(`Adding remote origin (${repoLink.trim()})...`).start();
        const addRemoteRes = await runCmd(`git remote add origin ${repoLink.trim()}`);
        if (!addRemoteRes.success) {
            // In case origin was already configured or failed, try setting URL
            await runCmd(`git remote set-url origin ${repoLink.trim()}`);
        }
        remoteAddSpinner.succeed(chalk.green('Remote origin added successfully.'));
    }

    // Step 6: Prompt for GitHub username
    console.log();
    const { username } = await inquirer.prompt([{
        type: 'input',
        name: 'username',
        message: chalk.cyan('Please send your username:'),
        validate: (input) => input.trim() ? true : 'Username cannot be empty.'
    }]);

    const configSpinner = createSpinner(`Setting credential username to "${username.trim()}"...`).start();
    const configRes = await runCmd(`git config --local credential.username "${username.trim()}"`);
    if (configRes.success) {
        configSpinner.succeed(chalk.green(`Configured git config --local credential.username "${username.trim()}".`));
    } else {
        configSpinner.warn(chalk.yellow('Could not set local credential.username, continuing...'));
    }

    // Step 7: Push to remote
    const pushSpinner = createSpinner('Pushing to GitHub (git push -u origin main)...').start();
    let pushRes = await runCmd('git push -u origin main');

    // If remote was named upstream, fallback to upstream
    if (!pushRes.success && (pushRes.stderr.includes("'origin'") || pushRes.stderr.includes('upstream'))) {
        const upstreamCheck = await runCmd('git remote');
        if (upstreamCheck.stdout.includes('upstream')) {
            pushSpinner.text = 'Trying git push -u upstream main...';
            pushRes = await runCmd('git push -u upstream main');
        }
    }

    if (pushRes.success) {
        pushSpinner.succeed(chalk.green('Successfully pushed to main branch!'));
        console.log(chalk.green('\n🎉 Repository setup and initial push complete!\n'));
    } else {
        pushSpinner.fail(chalk.red(`Push failed:\n${pushRes.stderr || pushRes.message}\n`));
    }
}
