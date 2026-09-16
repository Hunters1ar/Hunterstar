import fs from 'fs/promises';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import sharp from 'sharp';

export async function runConvert(args = []) {
    let fromExts = [];
    let toExt = null;
    let targetDir = process.cwd();
    let deleteOriginal = false;
    let quality = 85;

    // Parse flags and positional args
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--from' && args[i + 1]) {
            fromExts = args[++i].split(',').map(e => e.trim().replace(/^\./, '').toLowerCase());
        } else if (arg === '--to' && args[i + 1]) {
            toExt = args[++i].trim().replace(/^\./, '').toLowerCase();
        } else if (arg === '--dir' && args[i + 1]) {
            targetDir = path.resolve(process.cwd(), args[++i]);
        } else if (arg === '--quality' && args[i + 1]) {
            quality = parseInt(args[++i], 10) || 85;
        } else if (arg === '--delete' || arg === '--remove-original') {
            deleteOriginal = true;
        } else if (!arg.startsWith('--')) {
            // Positional handling: e.g. 'hunterstar convert png webp' or 'hunterstar convert png,jpg webp ./images'
            if (fromExts.length === 0) {
                fromExts = arg.split(',').map(e => e.trim().replace(/^\./, '').toLowerCase());
            } else if (!toExt) {
                toExt = arg.trim().replace(/^\./, '').toLowerCase();
            } else if (targetDir === process.cwd()) {
                targetDir = path.resolve(process.cwd(), arg);
            }
        }
    }

    if (fromExts.length === 0 || !toExt) {
        console.log(chalk.red('\n\u2717 Invalid arguments.'));
        console.log(chalk.yellow('\nUsage:'));
        console.log('  hunterstar convert --from <ext> --to <ext> [--dir <path>] [--quality <1-100>] [--delete]');
        console.log('  hunterstar convert <from_ext> <to_ext> [dir]');
        console.log(chalk.cyan('\nExamples:'));
        console.log('  hunterstar convert --from png,jpg,jpeg --to webp');
        console.log('  hunterstar convert --from webp --to png --dir ./images');
        console.log('  hunterstar convert png webp\n');
        return;
    }

    const validFormats = ['webp', 'png', 'jpg', 'jpeg', 'avif', 'tiff', 'gif'];
    if (!validFormats.includes(toExt)) {
        console.log(chalk.red(`\n\u2717 Unsupported target format: "${toExt}". Supported formats: ${validFormats.join(', ')}\n`));
        return;
    }

    const spinner = ora(`Scanning ${chalk.cyan(targetDir)} for .${fromExts.join(', .')} images...`).start();

    // Recursive file finder
    async function scanDirectory(dir) {
        let results = [];
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (['node_modules', '.git', '.next', '.vercel', 'dist', 'build'].includes(entry.name)) {
                        continue;
                    }
                    results = results.concat(await scanDirectory(fullPath));
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).replace(/^\./, '').toLowerCase();
                    if (fromExts.includes(ext)) {
                        results.push(fullPath);
                    }
                }
            }
        } catch (err) {
            // Ignore access errors on restricted directories
        }
        return results;
    }

    try {
        const filesToConvert = await scanDirectory(targetDir);

        if (filesToConvert.length === 0) {
            spinner.warn(chalk.yellow(`No files matching [${fromExts.join(', ')}] found in ${targetDir}`));
            return;
        }

        spinner.text = `Found ${filesToConvert.length} image(s). Starting conversion to .${toExt}...`;

        let successCount = 0;
        let failCount = 0;
        let totalOriginalBytes = 0;
        let totalConvertedBytes = 0;

        for (const filePath of filesToConvert) {
            try {
                const parsed = path.parse(filePath);
                const outputPath = path.join(parsed.dir, `${parsed.name}.${toExt}`);

                // Prevent overwriting same file if fromExt == toExt
                if (path.resolve(filePath) === path.resolve(outputPath)) {
                    continue;
                }

                const origStat = await fs.stat(filePath);
                totalOriginalBytes += origStat.size;

                let pipeline = sharp(filePath);

                if (toExt === 'webp') {
                    pipeline = pipeline.webp({ quality });
                } else if (toExt === 'png') {
                    pipeline = pipeline.png({ compressionLevel: 9 });
                } else if (toExt === 'jpg' || toExt === 'jpeg') {
                    pipeline = pipeline.jpeg({ quality });
                } else if (toExt === 'avif') {
                    pipeline = pipeline.avif({ quality });
                } else if (toExt === 'tiff') {
                    pipeline = pipeline.tiff({ quality });
                }

                await pipeline.toFile(outputPath);

                const newStat = await fs.stat(outputPath);
                totalConvertedBytes += newStat.size;

                if (deleteOriginal) {
                    await fs.unlink(filePath);
                }

                successCount++;
                spinner.text = `Converting (${successCount}/${filesToConvert.length}): ${parsed.base} \u2192 ${parsed.name}.${toExt}`;
            } catch (fileErr) {
                failCount++;
            }
        }

        const sizeDiffKb = ((totalOriginalBytes - totalConvertedBytes) / 1024).toFixed(1);
        const savedText = totalConvertedBytes < totalOriginalBytes
            ? chalk.green(` (Saved ${sizeDiffKb} KB)`)
            : '';

        spinner.succeed(
            chalk.green(`Conversion complete! Converted ${chalk.bold(successCount)} image(s) to .${toExt}.${savedText}`)
        );

        if (failCount > 0) {
            console.log(chalk.yellow(`\u26A0 ${failCount} image(s) could not be converted.`));
        }
        if (deleteOriginal) {
            console.log(chalk.gray(`\u2713 Original source files deleted as requested.`));
        }
    } catch (err) {
        spinner.fail(chalk.red(`Conversion process failed: ${err.message}`));
    }
}
