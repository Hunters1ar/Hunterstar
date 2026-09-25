-- 002_intelect.sql: Dynamic Teacher Distillation & Knowledge Rules Migration

CREATE TABLE IF NOT EXISTS teacher_distillation (
    id SERIAL PRIMARY KEY,
    "session_user" VARCHAR(64) NOT NULL DEFAULT 'anonymous',
    prompt TEXT NOT NULL,
    student_output TEXT NOT NULL,
    teacher_critique TEXT NOT NULL,
    ideal_response TEXT NOT NULL,
    lesson_taught TEXT,
    score INT CHECK (score BETWEEN 1 AND 10),
    user_context JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE teacher_distillation ADD COLUMN IF NOT EXISTS "session_user" VARCHAR(64) DEFAULT 'anonymous';
ALTER TABLE teacher_distillation ADD COLUMN IF NOT EXISTS student_output TEXT;
ALTER TABLE teacher_distillation ADD COLUMN IF NOT EXISTS score INT;
ALTER TABLE teacher_distillation ADD COLUMN IF NOT EXISTS lesson_taught TEXT;

CREATE TABLE IF NOT EXISTS knowledge_rules (
    id SERIAL PRIMARY KEY,
    scope VARCHAR(64) DEFAULT 'global',
    rule_text TEXT NOT NULL,
    weight INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE knowledge_rules ADD COLUMN IF NOT EXISTS scope VARCHAR(64) DEFAULT 'global';
ALTER TABLE knowledge_rules ADD COLUMN IF NOT EXISTS rule_text TEXT;
ALTER TABLE knowledge_rules ADD COLUMN IF NOT EXISTS weight INT DEFAULT 1;

DROP VIEW IF EXISTS active_fast_instructions;
CREATE OR REPLACE VIEW active_fast_instructions AS
SELECT 
    scope AS username,
    'identity' AS instruction_type,
    rule_text AS instruction,
    weight AS confidence_score,
    'Heavy-14B' AS taught_by,
    created_at AS updated_at
FROM knowledge_rules
ORDER BY created_at DESC;
