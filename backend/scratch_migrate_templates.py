from app.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    conn.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS hp_rating NUMERIC(4,1);"))
    conn.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS supply_type VARCHAR(20) DEFAULT '3-phase';"))
    conn.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS config_json JSONB DEFAULT '{}';"))
    conn.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS description TEXT;"))
    conn.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS desired_json JSONB DEFAULT '{}';"))
    conn.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS owner_user_id UUID;"))
    conn.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS owner_hierarchy_path TEXT;"))
    conn.execute(text("ALTER TABLE agripump.config_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;"))
    conn.commit()
print("Migration completed successfully!")
