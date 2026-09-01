#!/usr/bin/env node

import { runCLI } from '../src/index.js';

runCLI().catch((err) => {
    console.error('\x1b[31m[Fatal Error]\x1b[0m', err.message);
    process.exit(1);
});
