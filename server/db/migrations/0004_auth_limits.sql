-- 认证请求限额：只保存带密钥标识及有界事件时刻，不保存邮箱、原始 IP 或验证码。
CREATE TABLE auth_limits (
  id               INTEGER PRIMARY KEY,
  scope            TEXT NOT NULL CHECK (scope IN ('code-ip', 'code-email', 'code-global', 'login-ip', 'login-account')),
  subject_hash     TEXT NOT NULL CHECK (length(subject_hash) = 64 AND subject_hash NOT GLOB '*[^0-9a-f]*'),
  history          TEXT NOT NULL CHECK (json_valid(history) AND json_extract(history, '$.v') IS 1
                                        AND json_type(history, '$.times') IS 'array' AND length(history) <= 65536),
  blocked_until_at INTEGER NOT NULL DEFAULT 0 CHECK (blocked_until_at >= 0),
  updated_at       INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX uq_auth_limits_scope_subject_hash ON auth_limits (scope, subject_hash);
CREATE INDEX idx_auth_limits_updated_at ON auth_limits (updated_at);
