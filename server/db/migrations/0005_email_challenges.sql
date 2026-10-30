-- 短期邮箱挑战；原始验证码不落库，临时密文及 HMAC 在终态立即清除。
CREATE TABLE email_challenges (
  id             INTEGER PRIMARY KEY,
  challenge_id   TEXT NOT NULL CHECK (length(challenge_id) = 32 AND challenge_id NOT GLOB '*[^0-9a-f]*'),
  email_lookup   TEXT NOT NULL CHECK (length(email_lookup) = 64 AND email_lookup NOT GLOB '*[^0-9a-f]*'),
  purpose        TEXT NOT NULL CHECK (purpose IN ('register', 'reset', 'change')),
  state          TEXT NOT NULL CHECK (state IN ('queued', 'sending', 'sent', 'unknown', 'failed', 'consumed', 'superseded')),
  is_current     INTEGER NOT NULL CHECK (is_current IN (0, 1)),
  email_payload  TEXT CHECK (email_payload IS NULL OR (length(email_payload) <= 1024 AND json_valid(email_payload))),
  code_mac       TEXT CHECK (code_mac IS NULL OR (length(code_mac) = 64 AND code_mac NOT GLOB '*[^0-9a-f]*')),
  code_key_id    TEXT CHECK (code_key_id IS NULL OR length(code_key_id) BETWEEN 1 AND 32),
  attempts       INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at     INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at     INTEGER NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + 600000),
  sent_at        INTEGER CHECK (sent_at IS NULL OR (sent_at >= created_at AND sent_at < expires_at)),
  CHECK (
    (state = 'queued' AND is_current = 1 AND email_payload IS NOT NULL AND code_mac IS NULL AND code_key_id IS NULL AND sent_at IS NULL) OR
    (state = 'sending' AND is_current = 1 AND email_payload IS NOT NULL AND code_mac IS NOT NULL AND code_key_id IS NOT NULL AND sent_at IS NULL) OR
    (state = 'sent' AND is_current = 1 AND email_payload IS NULL AND code_mac IS NOT NULL AND code_key_id IS NOT NULL AND sent_at IS NOT NULL) OR
    (state IN ('unknown', 'failed', 'consumed', 'superseded') AND email_payload IS NULL AND code_mac IS NULL AND code_key_id IS NULL)
  ),
  CHECK (state NOT IN ('consumed', 'superseded') OR is_current = 0)
) STRICT;
CREATE UNIQUE INDEX uq_email_challenges_challenge_id ON email_challenges (challenge_id);
CREATE UNIQUE INDEX uq_email_challenges_email_lookup_purpose ON email_challenges (email_lookup, purpose) WHERE is_current = 1;
CREATE INDEX idx_email_challenges_expires_at ON email_challenges (expires_at);
