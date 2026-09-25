-- 003_heavy_master_teach.sql: Heavy AI Self-Learning & Cloud Masterpiece Distillation
-- Prevents trial-and-error loops across platforms (Windows/PowerShell, Linux/Bash, macOS/Zsh)
-- Replaces multi-turn exploratory guesses with single 1-shot masterpiece commands.

-- 1. Masterpiece Strategies Repository
CREATE TABLE IF NOT EXISTS heavy_master_strategies (
    id SERIAL PRIMARY KEY,
    task_intent VARCHAR(100) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    shell VARCHAR(50) NOT NULL,
    masterpiece_command TEXT NOT NULL,
    strategy_summary TEXT,
    avoid_patterns TEXT,
    taught_by VARCHAR(50) DEFAULT 'cloud-master',
    success_count INT DEFAULT 1,
    weight INT DEFAULT 10,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_heavy_strategy UNIQUE(task_intent, platform, shell)
);

-- 2. Heavy AI Multi-Turn Distillation Log
CREATE TABLE IF NOT EXISTS heavy_master_distillation (
    id SERIAL PRIMARY KEY,
    prompt TEXT NOT NULL,
    task_intent VARCHAR(100) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    shell VARCHAR(50) NOT NULL,
    trial_commands JSONB NOT NULL DEFAULT '[]',
    steps_count INT DEFAULT 1,
    masterpiece_command TEXT NOT NULL,
    master_critique TEXT,
    taught_by VARCHAR(50) DEFAULT 'cloud-master',
    latency_saved_est_sec NUMERIC(5,2) DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_heavy_strategy_intent ON heavy_master_strategies(task_intent, platform, shell);
CREATE INDEX IF NOT EXISTS idx_heavy_distill_intent ON heavy_master_distillation(task_intent);

-- 3. Active Strategies View
DROP VIEW IF EXISTS active_heavy_strategies;
CREATE OR REPLACE VIEW active_heavy_strategies AS
SELECT 
    id,
    task_intent,
    platform,
    shell,
    masterpiece_command,
    strategy_summary,
    avoid_patterns,
    taught_by,
    weight,
    success_count,
    updated_at
FROM heavy_master_strategies
WHERE is_active = TRUE
ORDER BY weight DESC, updated_at DESC;

-- 4. Initial Seed Masterpiece Strategies for Instant Stability & Speed
-- (Ensures Heavy AI executes flawlessly on Turn 1 without exploratory loops)

-- [Intent: analyze_project]
INSERT INTO heavy_master_strategies (task_intent, platform, shell, masterpiece_command, strategy_summary, avoid_patterns, taught_by, weight)
VALUES 
(
    'analyze_project', 'windows', 'powershell',
    'Get-ChildItem -Depth 2 -File | Where-Object { $_.FullName -notmatch ''node_modules|\.git|dist|build|\.next|bin|obj'' } | Select-Object -First 25 -ExpandProperty FullName; Get-Content package.json, tsconfig.json, README.md, Cargo.toml, pyproject.toml, go.mod -ErrorAction SilentlyContinue -TotalCount 40',
    'One-shot project discovery: inspects top-level directory structure up to depth 2 while excluding heavy build/cache folders, then reads core configuration manifests.',
    'Do not run unbounded -Recurse across disk; do not scan node_modules; do not run separate Get-ChildItem and multiple Get-Content roundtrips.',
    'cloud-master', 20
),
(
    'analyze_project', 'linux', 'bash',
    'find . -maxdepth 2 -not -path ''*/.*'' -not -path ''*node_modules*'' -not -path ''*dist*'' -not -path ''*build*'' -type f | head -n 25; head -n 40 package.json tsconfig.json README.md Cargo.toml pyproject.toml go.mod 2>/dev/null',
    'Single-line project discovery combining bounded find depth with manifest file reading.',
    'Do not run unbounded find /; do not search node_modules; avoid multi-turn trial grep.',
    'cloud-master', 20
),
(
    'analyze_project', 'darwin', 'zsh',
    'find . -maxdepth 2 -not -path ''*/.*'' -not -path ''*node_modules*'' -not -path ''*dist*'' -not -path ''*build*'' -type f | head -n 25; head -n 40 package.json tsconfig.json README.md Cargo.toml pyproject.toml go.mod 2>/dev/null',
    'Single-line project discovery for macOS zsh.',
    'Do not run unbounded find /; do not search node_modules.',
    'cloud-master', 20
)
ON CONFLICT (task_intent, platform, shell) 
DO UPDATE SET 
    masterpiece_command = EXCLUDED.masterpiece_command,
    strategy_summary = EXCLUDED.strategy_summary,
    avoid_patterns = EXCLUDED.avoid_patterns,
    updated_at = CURRENT_TIMESTAMP;

-- [Intent: security_scan]
INSERT INTO heavy_master_strategies (task_intent, platform, shell, masterpiece_command, strategy_summary, avoid_patterns, taught_by, weight)
VALUES 
(
    'security_scan', 'windows', 'powershell',
    'Get-ChildItem -Path . -Depth 3 -File | Where-Object { $_.FullName -notmatch ''node_modules|\.git|dist|build|\.lock|package-lock\.json'' } | Select-String -Pattern ''(password|secret|api[_-]?key|token|bearer|private[_-]?key)\s*[:=]'' | Select-Object -First 20 -Property Path, LineNumber',
    'Fast secret and credential leak scan limited to depth 3 and excluding build caches and lockfiles. Reports paths and line numbers without printing raw secret values.',
    'Never print actual secret tokens in console; never scan node_modules or binary lockfiles.',
    'cloud-master', 20
),
(
    'security_scan', 'linux', 'bash',
    'grep -rnEI --exclude-dir={node_modules,.git,dist,build} --exclude=''*lock*'' -e ''(password|secret|api[_-]?key|token|bearer|private[_-]?key)\s*[:=]'' . 2>/dev/null | head -n 20',
    'High-speed binary-safe grep scan excluding package directories and lockfiles.',
    'Do not search entire filesystem; avoid reading minified build output.',
    'cloud-master', 20
),
(
    'security_scan', 'darwin', 'zsh',
    'grep -rnEI --exclude-dir={node_modules,.git,dist,build} --exclude=''*lock*'' -e ''(password|secret|api[_-]?key|token|bearer|private[_-]?key)\s*[:=]'' . 2>/dev/null | head -n 20',
    'High-speed grep scan for macOS environments.',
    'Do not search entire filesystem; avoid reading minified build output.',
    'cloud-master', 20
)
ON CONFLICT (task_intent, platform, shell) 
DO UPDATE SET 
    masterpiece_command = EXCLUDED.masterpiece_command,
    strategy_summary = EXCLUDED.strategy_summary,
    avoid_patterns = EXCLUDED.avoid_patterns,
    updated_at = CURRENT_TIMESTAMP;
