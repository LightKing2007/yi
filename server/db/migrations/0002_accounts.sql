-- 账号：公开标识不可变；注销后只保留公开标识及内部关联，邮箱与凭据清空（DAT-074）。
CREATE TABLE accounts (
  id                 INTEGER PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  public_id          TEXT NOT NULL CHECK (length(public_id) = 8 AND public_id NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  email_version      INTEGER CHECK (email_version = 1),                                    -- NULL 仅表示账号已注销
  email_key_id       TEXT CHECK (length(email_key_id) BETWEEN 1 AND 32),                    -- NULL 仅表示账号已注销
  email_nonce        TEXT CHECK (length(email_nonce) = 24 AND email_nonce NOT GLOB '*[^0-9a-f]*'),
  email_tag          TEXT CHECK (length(email_tag) = 32 AND email_tag NOT GLOB '*[^0-9a-f]*'),
  email_cipher       TEXT CHECK (length(email_cipher) BETWEEN 2 AND 508 AND length(email_cipher) % 2 = 0
                                 AND email_cipher NOT GLOB '*[^0-9a-f]*'),
  email_lookup       TEXT CHECK (length(email_lookup) = 64 AND email_lookup NOT GLOB '*[^0-9a-f]*'),
  email_verified_at  INTEGER,                                                             -- NULL 仅表示账号已注销
  pass_hash          TEXT CHECK (length(pass_hash) = 179 AND substr(pass_hash, 1, 18) = 'scrypt$131072$8$1$'
                                 AND substr(pass_hash, 51, 1) = '$'
                                 AND substr(pass_hash, 19, 32) NOT GLOB '*[^0-9a-f]*'
                                 AND substr(pass_hash, 52, 128) NOT GLOB '*[^0-9a-f]*'),                      -- NULL 仅表示账号已注销
  auth_version       INTEGER NOT NULL DEFAULT 1 CHECK (auth_version >= 1),
  created_at         INTEGER NOT NULL,
  closed_at          INTEGER,                                                             -- NULL 表示仍在使用
  CHECK (
    (status = 'active' AND email_version IS NOT NULL AND email_key_id IS NOT NULL
      AND email_nonce IS NOT NULL AND email_tag IS NOT NULL AND email_cipher IS NOT NULL
      AND email_lookup IS NOT NULL AND email_verified_at IS NOT NULL AND pass_hash IS NOT NULL AND closed_at IS NULL)
    OR
    (status = 'closed' AND email_version IS NULL AND email_key_id IS NULL AND email_nonce IS NULL
      AND email_tag IS NULL AND email_cipher IS NULL AND email_lookup IS NULL
      AND email_verified_at IS NULL AND pass_hash IS NULL AND closed_at IS NOT NULL)
  )
) STRICT;
CREATE UNIQUE INDEX uq_accounts_user_id ON accounts (user_id);
CREATE UNIQUE INDEX uq_accounts_public_id ON accounts (public_id);
CREATE UNIQUE INDEX uq_accounts_email_lookup ON accounts (email_lookup) WHERE email_lookup IS NOT NULL;

-- 防止普通更新错误地改掉已发放的 UID；它不是权限或所有权证明。
CREATE TRIGGER accounts_public_id_immutable
BEFORE UPDATE OF public_id ON accounts
WHEN OLD.public_id <> NEW.public_id
BEGIN
  SELECT RAISE(ABORT, 'public-id-immutable');
END;

-- 协议同意：保留准确版本与服务端记录时刻，不以客户端布尔值代替。
CREATE TABLE consents (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  kind           TEXT NOT NULL CHECK (kind IN ('privacy', 'terms')),
  document_version TEXT NOT NULL CHECK (length(document_version) BETWEEN 1 AND 64),
  consented_at   INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX uq_consents_user_id_kind_document_version ON consents (user_id, kind, document_version);
