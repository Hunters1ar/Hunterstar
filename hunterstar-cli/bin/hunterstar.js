#!/usr/bin/env node

import { runCLI } from '../src/index.js';
import { initGlobalErrorTracking, reportErrorToTelegram } from '../src/analytics.js';

initGlobalErrorTracking();

runCLI().catch(async (err) => {
    // Handle user pressing Ctrl+C in inquirer prompts
    if (err.name === 'ExitPromptError' || (err.message && err.message.includes('force closed'))) {
        console.log('\n\x1b[33mOperation cancelled.\x1b[0m');
        process.exit(0);
    }

    console.error('\x1b[31m[Fatal Error]\x1b[0m', err.message);
    await reportErrorToTelegram(err, 'Top-level runCLI catch');
    process.exit(1);
});
