-- 002_intelect.sql: Heavy Masterpiece Strategy Distillation
-- Teacher distillation and knowledge_rules tables removed in v2.1.8
-- The AI no longer uses SQL-backed dynamic rule injection into the Fast model

-- Drop legacy teacher tables if they exist from old installs
DROP TABLE IF EXISTS teacher_distillation CASCADE;
DROP TABLE IF EXISTS knowledge_rules CASCADE;
DROP VIEW IF EXISTS active_fast_instructions;
