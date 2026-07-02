-- JMG webhook store (PostgreSQL)
-- Run once when provisioning DATABASE_URL for jmg-dashboard

CREATE TABLE IF NOT EXISTS webhook_inbox (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_received_at ON webhook_inbox (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_inbox_entity_type ON webhook_inbox (entity_type);
CREATE INDEX IF NOT EXISTS idx_webhook_inbox_entity_id ON webhook_inbox (entity_id);
