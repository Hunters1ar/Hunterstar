-- 003_heavy_master_teach.sql: Heavy AI Self-Learning & Cloud Masterpiece Distillation
-- Pure schema definition: ZERO hardcoded seed rules or commands.
-- Heavy AI and Cloud AI teach themselves dynamically via the distillation loop.

-- 1. Masterpiece Strategies Repository
CREATE TABLE IF NOT EXISTS heavy_master_strategies (
    id SERIAL PRIMARY KEY,
    task_intent VARCHAR(100) NOT NULL,
    platform VARCHAR(50) NOT NULL,
    shell VARCHAR(50) NOT NULL,
    masterpiece_command TEXT NOT NULL,
    strategy_summary TEXT,
    avoid_patterns TEXT,
    taught_by VARCHAR(50) DEFAULT 'heavy-self',
    success_count INT DEFAULT 1,
    weight INT DEFAULT 1,
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
    taught_by VARCHAR(50) DEFAULT 'heavy-self',
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
