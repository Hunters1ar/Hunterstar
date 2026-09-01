import fs from 'fs';
import path from 'path';

function detectFrontend(cwd) {
    let pkg = {};
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) {}
    }
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scripts = pkg.scripts || {};

    if (deps['vite'] || deps['react-scripts'] || deps['next'] || deps['nuxt'] || deps['vue'] || deps['@angular/core'] || deps['svelte']) {
        const startCommand = scripts.dev ? 'npm run dev' : (scripts.start ? 'npm start' : null);
        if (startCommand) {
            let fType = 'React/Vite';
            if (deps['next']) fType = 'Next.js';
            else if (deps['@angular/core']) fType = 'Angular';
            else if (deps['nuxt']) fType = 'Nuxt.js';
            else if (deps['vue']) fType = 'Vue.js';
            else if (deps['svelte']) fType = 'SvelteKit';
            return { type: fType, command: startCommand, cwd };
        }
    } else if (fs.existsSync(path.join(cwd, 'index.html'))) {
        const startCommand = scripts.dev ? 'npm run dev' : (scripts.start ? 'npm start' : 'npx --yes serve .');
        return { type: 'Static HTML', command: startCommand, cwd };
    }
    return null;
}

function detectBackend(cwd) {
    let pkg = {};
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) {}
    }
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scripts = pkg.scripts || {};

    if (deps['express'] || deps['@nestjs/core'] || deps['fastify'] || deps['koa']) {
        const startCommand = scripts.server ? 'npm run server' : (scripts.start ? 'npm start' : (scripts.dev ? 'npm run dev' : 'node server.js'));
        let bType = 'Express/Node';
        if (deps['@nestjs/core']) bType = 'NestJS';
        else if (deps['fastify']) bType = 'Fastify';
        else if (deps['koa']) bType = 'Koa';
        return { type: bType, command: startCommand, cwd };
    }

    const reqPath = path.join(cwd, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
        const reqContent = fs.readFileSync(reqPath, 'utf8').toLowerCase();
        if (reqContent.includes('fastapi')) {
            let uvicornCmd = 'python -m uvicorn main:app --reload';
            if (fs.existsSync(path.join(cwd, 'app.py')) && !fs.existsSync(path.join(cwd, 'main.py'))) {
                uvicornCmd = 'python -m uvicorn app:app --reload';
            }
            return { type: 'FastAPI', command: uvicornCmd, cwd };
        }
        if (reqContent.includes('django')) return { type: 'Django', command: 'python manage.py runserver', cwd };
        if (reqContent.includes('flask')) return { type: 'Flask', command: 'flask run', cwd };
    }

    if (fs.existsSync(path.join(cwd, 'manage.py'))) return { type: 'Django', command: 'python manage.py runserver', cwd };
    if (fs.existsSync(path.join(cwd, 'main.py'))) return { type: 'Python App', command: 'python main.py', cwd };
    if (fs.existsSync(path.join(cwd, 'app.py'))) return { type: 'Python App', command: 'python app.py', cwd };

    return null;
}

function detectDatabases(cwd) {
    const dbs = new Set();

    // Check Prisma
    if (fs.existsSync(path.join(cwd, 'prisma', 'schema.prisma')) || fs.existsSync(path.join(cwd, 'schema.prisma'))) {
        try {
            const schema = fs.readFileSync(fs.existsSync(path.join(cwd, 'prisma', 'schema.prisma')) ? path.join(cwd, 'prisma', 'schema.prisma') : path.join(cwd, 'schema.prisma'), 'utf8');
            if (schema.includes('provider = "postgresql"')) dbs.add('PostgreSQL');
            else if (schema.includes('provider = "mysql"')) dbs.add('MySQL');
            else if (schema.includes('provider = "sqlite"')) dbs.add('SQLite');
            else if (schema.includes('provider = "mongodb"')) dbs.add('MongoDB');
        } catch(e) {}
    }

    // Check docker-compose
    const composePaths = ['docker-compose.yml', 'docker-compose.yaml'];
    for (const p of composePaths) {
        if (fs.existsSync(path.join(cwd, p))) {
            try {
                const compose = fs.readFileSync(path.join(cwd, p), 'utf8').toLowerCase();
                if (compose.includes('postgres')) dbs.add('PostgreSQL (Docker)');
                if (compose.includes('mysql')) dbs.add('MySQL (Docker)');
                if (compose.includes('redis')) dbs.add('Redis (Docker)');
                if (compose.includes('mongo')) dbs.add('MongoDB (Docker)');
            } catch(e) {}
        }
    }

    // Check .env
    if (fs.existsSync(path.join(cwd, '.env'))) {
        try {
            const env = fs.readFileSync(path.join(cwd, '.env'), 'utf8').toLowerCase();
            if (env.includes('postgres://')) dbs.add('PostgreSQL');
            if (env.includes('mysql://')) dbs.add('MySQL');
            if (env.includes('mongodb://') || env.includes('mongodb+srv://')) dbs.add('MongoDB');
            if (env.includes('redis://')) dbs.add('Redis');
        } catch(e) {}
    }

    return Array.from(dbs);
}

export function analyzeProject(cwd) {
    const result = {
        frontend: null,
        backend: null,
        databases: [],
        configSource: 'auto-detect'
    };

    const configPath = path.join(cwd, 'hunterstar.json');
    if (fs.existsSync(configPath)) {
        try {
            const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (userConfig.server) {
                if (userConfig.server.frontend?.enabled !== false && userConfig.server.frontend?.command) {
                    result.frontend = { type: 'custom', command: userConfig.server.frontend.command, cwd: userConfig.server.frontend.cwd || cwd };
                }
                if (userConfig.server.backend?.enabled !== false && userConfig.server.backend?.command) {
                    result.backend = { type: 'custom', command: userConfig.server.backend.command, cwd: userConfig.server.backend.cwd || cwd };
                }
                result.configSource = 'hunterstar.json';
                return result;
            }
        } catch (e) {
            console.warn('\x1b[33m[Warning]\x1b[0m Could not parse hunterstar.json, falling back to auto-detect.');
        }
    }

    // Try root first
    result.frontend = detectFrontend(cwd);
    result.backend = detectBackend(cwd);

    const subDirsToSearch = ['frontend', 'web', 'client', 'app', 'apps/web', 'backend', 'api', 'server', 'apps/api'];
    
    // Aggregate DBs from root and all subdirectories
    let allDbs = new Set(detectDatabases(cwd));

    for (const sub of subDirsToSearch) {
        const fullPath = path.join(cwd, sub);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
            if (!result.frontend) {
                const found = detectFrontend(fullPath);
                if (found) result.frontend = found;
            }
            if (!result.backend) {
                const found = detectBackend(fullPath);
                if (found) result.backend = found;
            }
            const subDbs = detectDatabases(fullPath);
            subDbs.forEach(db => allDbs.add(db));
        }
    }

    result.databases = Array.from(allDbs);

    return result;
}
