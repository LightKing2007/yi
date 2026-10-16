-- 元数据：结构版本 schema_version 等（DAT-041）
CREATE TABLE meta (
  id         INTEGER PRIMARY KEY,
  meta_name  TEXT NOT NULL CHECK (length(meta_name) BETWEEN 1 AND 64),
  meta_text  TEXT NOT NULL CHECK (length(meta_text) <= 2000)
) STRICT;
CREATE UNIQUE INDEX uq_meta_meta_name ON meta (meta_name);

-- 用户：阶段 5 只有游客，一个 uid_hash 对应一个游客用户；会员的列由阶段 6 的迁移新增
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('guest', 'member')),
  name          TEXT NOT NULL CHECK (length(CAST(name AS BLOB)) BETWEEN 1 AND 64),   -- 最近一次使用的昵称，按 UTF-8 字节计（DAT-022）
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
) STRICT;

-- 设备：客户端本地 uid 的散列 sha256('yi:' + uid) 的前 32 位（DAT-075），用于关联游客与（阶段 6 起）会员
CREATE TABLE devices (
  id             INTEGER PRIMARY KEY,
  uid_hash       TEXT NOT NULL CHECK (length(uid_hash) = 32 AND uid_hash NOT GLOB '*[^0-9a-f]*'),
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX uq_devices_uid_hash_user_id ON devices (uid_hash, user_id);
CREATE INDEX idx_devices_user_id ON devices (user_id);

-- 段位：每人每种棋一行
CREATE TABLE ratings (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  game_type   TEXT NOT NULL CHECK (game_type IN ('gomoku', 'go')),
  points      INTEGER NOT NULL DEFAULT 1200 CHECK (points >= 0),
  win_count   INTEGER NOT NULL DEFAULT 0 CHECK (win_count >= 0),
  loss_count  INTEGER NOT NULL DEFAULT 0 CHECK (loss_count >= 0),
  draw_count  INTEGER NOT NULL DEFAULT 0 CHECK (draw_count >= 0),
  updated_at  INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX uq_ratings_user_id_game_type ON ratings (user_id, game_type);

-- 对局：开局时插入，终局时在结算事务中更新（DAT-040）
CREATE TABLE games (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('match', 'ranked', 'friend')),
  game_type      TEXT NOT NULL CHECK (game_type IN ('gomoku', 'go')),
  board_size     INTEGER NOT NULL CHECK (board_size IN (9, 13, 15, 19)),
  black_user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  white_user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  record         TEXT CHECK (record IS NULL OR (json_valid(record) AND length(record) <= 262144)),  -- 棋谱，见 5.2.3；NULL 表示尚未终局
  move_count     INTEGER NOT NULL DEFAULT 0 CHECK (move_count BETWEEN 0 AND 1024),
  winner         TEXT CHECK (winner IN ('black', 'white', 'draw')),                                 -- NULL 表示尚未终局
  end_reason     TEXT CHECK (end_reason IN ('five', 'full', 'score', 'resign', 'timeout', 'disconnect', 'draw', 'left', 'limit', 'aborted')),  -- NULL 表示尚未终局
  is_rated       INTEGER NOT NULL DEFAULT 0 CHECK (is_rated IN (0, 1)),                             -- 本局是否结算了段位
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,                                                                           -- NULL 表示尚未终局
  CHECK ((ended_at IS NULL) = (end_reason IS NULL) AND (ended_at IS NULL) = (winner IS NULL)),
  CHECK (is_rated = 0 OR kind = 'ranked')
) STRICT;
CREATE INDEX idx_games_black_user_id_ended_at ON games (black_user_id, ended_at);
CREATE INDEX idx_games_white_user_id_ended_at ON games (white_user_id, ended_at);
CREATE INDEX idx_games_ended_at ON games (ended_at);

-- 段位变化明细：每一次段位分的变化一行，可以精确回滚
CREATE TABLE rating_changes (
  id             INTEGER PRIMARY KEY,
  game_id        INTEGER REFERENCES games (id) ON DELETE RESTRICT,   -- NULL 表示不是由对局引起（回滚、管理操作）
  user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  game_type      TEXT NOT NULL CHECK (game_type IN ('gomoku', 'go')),
  points_before  INTEGER NOT NULL CHECK (points_before >= 0),
  points_after   INTEGER NOT NULL CHECK (points_after >= 0),
  cause          TEXT NOT NULL CHECK (cause IN ('game', 'rollback', 'admin')),
  changed_at     INTEGER NOT NULL,
  CHECK ((cause = 'game') = (game_id IS NOT NULL))
) STRICT;
CREATE INDEX idx_rating_changes_user_id_changed_at ON rating_changes (user_id, changed_at);
CREATE INDEX idx_rating_changes_game_id ON rating_changes (game_id);
