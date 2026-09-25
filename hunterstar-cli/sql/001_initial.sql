-- 001_initial.sql: Core users, devices, and sessions migration

CREATE TABLE IF NOT EXISTS users_and_devices (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    device_id VARCHAR(100) NOT NULL DEFAULT 'default',
    hostname VARCHAR(100),
    platform VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_device UNIQUE(username, device_id)
);

CREATE TABLE IF NOT EXISTS taught_instructions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users_and_devices(id) ON DELETE CASCADE,
    username VARCHAR(100) NOT NULL,
    instruction_type VARCHAR(50) DEFAULT 'identity',
    instruction TEXT NOT NULL,
    taught_by VARCHAR(50) DEFAULT 'Heavy-14B',
    confidence_score NUMERIC(3,2) DEFAULT 1.0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_devices_user ON users_and_devices(username);
CREATE INDEX IF NOT EXISTS idx_taught_instructions_user ON taught_instructions(username);
