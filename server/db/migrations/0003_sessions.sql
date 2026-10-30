-- 登录令牌仅保存 SHA-256 散列，账号世代变化即时使原会话失效（DAT-070、SEC-021）。
CREATE TABLE sessions (
  id             INTEGER PRIMARY KEY,
  token_hash     TEXT NOT NULL CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  auth_version   INTEGER NOT NULL CHECK (auth_version >= 1),
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + 2592000000),
  last_seen_at   INTEGER NOT NULL CHECK (last_seen_at >= created_at AND last_seen_at < expires_at)
) STRICT;
CREATE UNIQUE INDEX uq_sessions_token_hash ON sessions (token_hash);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX idx_sessions_last_seen_at ON sessions (last_seen_at);
