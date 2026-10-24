#!/bin/sh
# 上线在服务器上的部分：由 scripts/deploy.sh 连同要上线的文件传到 /opt/yi/.incoming/ 下的临时目录后执行，做完即删除该目录。
#   sh deploy-remote.sh preflight 版本号 所需KB [--allow-downgrade]   上线前检查（目录结构、版本、磁盘空间），并打出线上状态
#   sh deploy-remote.sh install 版本号 [--allow-downgrade] [--no-restart] 建版本目录、切换、重启并检查，不通过即自动回滚
#   sh deploy-remote.sh restart                                         重启（有对局时先进入维护模式），不通过即自动回滚
#   sh deploy-remote.sh rollback                                        立即换回上一版本并重启（再执行一次又换回来）
#   sh deploy-remote.sh status                                          打出线上的版本、对局数、是否维护中与连接数
#   sh deploy-remote.sh service                                         安装同目录下的 yi.service（SEC-045），重启并检查，不通过即恢复原文件
#   sh deploy-remote.sh offsite                                         安装异地加密备份（P1-13）：程序、单元文件与配置，并立即上传一次
#   sh deploy-remote.sh watch                                           上线后的检查（OPS-047），由上线成功后建立的定时器 yi-watch 每分钟运行
#   sh deploy-remote.sh caddy                                           安装同目录下的 yi.caddy（Caddy 中弈的站点配置），校验后平滑重载并检查，不通过即恢复原文件
#   sh deploy-remote.sh deploy-user                                     建立部署用户 deploy，安装本脚本为 /usr/local/sbin/yi-deploy 与 sudo 白名单（SEC-044）
# 部署用户 deploy 经 sudo 执行 /usr/local/sbin/yi-deploy（本脚本的 root 所有的副本）时，只允许 preflight、install、restart、rollback、
# status；install 以 --from=目录 指定 deploy 上传文件的目录，文件以 deploy 的身份读出、复制到 root 所有的临时目录后才使用。
# 其余命令安装以 root 身份运行的配置，仍须以 root 执行（SEC-044）
# 目录（OPS-043）：/opt/yi/releases/版本号/ 下为 server.cjs、download/（安装程序）、env（YI_LATEST）；
# /opt/yi/current、/opt/yi/previous 为指向版本目录的符号链接，yi.service 经 current 读取三者。
# 规则：加锁 OPS-041；降级确认 OPS-042；整体回滚 OPS-044；维护模式 OPS-045；健康检查与自动回滚 OPS-046；部署日志 OPS-048
set -eu
trap '' HUP PIPE # ssh 断开后照常做完：维护模式与重启后的检查不能停在半路

ROOT=${YI_ROOT:-/opt/yi}
STATE=${YI_STATE:-/var/lib/yi}
NODE=${YI_NODE:-/opt/node/bin/node}
PORT=${YI_PORT:-8443}
LOCK=${YI_LOCK:-/run/yi-deploy.lock}
UNIT_FILE=${YI_UNIT_FILE:-/etc/systemd/system/yi.service}
SYSTEMD_DIR=${YI_SYSTEMD_DIR:-/etc/systemd/system}
ETC=${YI_ETC:-/etc/yi}
CADDYFILE=${YI_CADDYFILE:-/etc/caddy/Caddyfile}
CADDY_SITES=${YI_CADDY_SITES:-/etc/caddy/sites}
SITE=yi.lightking.com.cn
# 经 sudo 执行时发起的用户（sudo 设置，不能伪造）；以 root 直接执行时为空
UPLOADER=${SUDO_USER:-}
[ "$UPLOADER" != root ] || UPLOADER=
# 部署日志中的操作者：只留字母、数字与 ._-（经 sudo 时 YI_OPERATOR 由白名单放行，同样不可信）
WHO=$(printf %s "${YI_OPERATOR:-${UPLOADER:-unknown}}" | tr -c 'A-Za-z0-9._-' _)
DEPLOY_USER=deploy
BIN=${YI_BIN:-/usr/local/sbin/yi-deploy}
SUDOERS=${YI_SUDOERS:-/etc/sudoers.d/yi-deploy}
ROOT_KEYS=${YI_ROOT_KEYS:-/root/.ssh/authorized_keys}
WAIT_STEP=10     # 维护模式中每 10 秒查一次活跃对局数
WAIT_POLLS=${YI_WAIT_POLLS:-180} # 至多 180 次，即 30 分钟（OPS-045；测试时改小）
HEALTH_POLLS=${YI_HEALTH_POLLS:-30} # 重启后每秒查一次健康检查，至多 30 秒（OPS-046；测试时改小）
SITE_POLLS=${YI_SITE_POLLS:-60} # 重载 Caddy 后每秒经 HTTPS 检查一次，至多 60 秒：首次安装时要先申请证书（测试时改小）
SCORE_MAX=4.0    # systemd-analyze security 的评分上限（SEC-045）
LOCK_BUSY=75     # flock 拿不到锁时的退出码
WATCH_SECS=3600         # 上线后检查 60 分钟（OPS-047）
WATCH_WINDOW=5          # 重启次数与错误占比按最近 5 分钟计
WATCH_RESTARTS=3        # 5 分钟内重启 ≥ 3 次即回滚
WATCH_HEALTH_FAILS=3    # 健康检查连续失败 3 次即回滚
WATCH_MIN_MESSAGES=100  # 5 分钟内少于 100 条消息时不计错误占比
WATCH_ERROR_PERCENT=1   # E5 错误占全部消息 ≥ 1% 即回滚
HERE=$(cd "$(dirname "$0")" && pwd)

# 版本号 $1 是否低于 $2（均为 主.次.修订）
version_lt() {
  a1=${1%%.*} ar=${1#*.} b1=${2%%.*} br=${2#*.}
  a2=${ar%%.*} a3=${ar#*.} b2=${br%%.*} b3=${br#*.}
  [ "$a1" -lt "$b1" ] && return 0
  [ "$a1" -gt "$b1" ] && return 1
  [ "$a2" -lt "$b2" ] && return 0
  [ "$a2" -gt "$b2" ] && return 1
  [ "$a3" -lt "$b3" ]
}

# 测试只载入上面的函数（tests/deployRemote.test.ts）
if [ "${YI_DEPLOY_LIB:-}" = 1 ]; then return 0; fi

# 传上来的临时目录做完即删；在别处（如测试）执行时不删
case "$HERE" in "$ROOT"/.incoming/*) trap 'rm -rf "$HERE"' EXIT ;; esac

# 打出一行，同时记入本次上线的完整输出；ssh 已断开时照常记入
say() {
  printf '%s\n' "$*" >>"$STATE/deploy-last.log" 2>/dev/null || true
  printf '%s\n' "$*" 2>/dev/null || true
}
fail() { say "✗ $1"; exit 1; }

# 追加一行部署日志（OPS-048）：时间 操作者 操作 版本 结果
record() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $WHO $1 $2 $3" >>"$STATE/deploy.log"; }

# 健康检查（API-061）：打出“版本号 提交号 活跃对局数 是否维护中”；连不上时返回非零
health() {
  "$NODE" -e 'fetch("http://127.0.0.1:" + process.argv[1] + "/healthz")
    .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(h => console.log(h.version, h.commit, h.games, h.maintenance), () => process.exit(1))' "$PORT" 2>/dev/null
}

# 符号链接 $1（current 或 previous）指向的版本号；没有时为空
linked() { if [ -L "$ROOT/$1" ]; then basename "$(readlink "$ROOT/$1")"; fi; }

# 版本目录 $1 中服务端的提交号（server.cjs --version 打出“版本号（提交号）”）
commit_of() { "$NODE" "$ROOT/releases/$1/server.cjs" --version | sed 's/.*（\(.*\)）.*/\1/'; }

# 有活跃对局时进入维护模式，等对局结束，至多 30 分钟（OPS-045）。连不上健康检查（服务端未在运行）时无从得知对局数，直接重启
drain() {
  h=$(health) || { say "连不上线上服务端的健康检查，无法得知对局数，直接重启"; return 0; }
  set -- $h
  [ "$3" -eq 0 ] && return 0
  say "有 ${3} 局正在进行：进入维护模式，不再开始新的对局，等现有对局结束后重启（至多 30 分钟）"
  systemctl kill -s SIGUSR2 yi
  i=0
  while [ "$i" -lt "$WAIT_POLLS" ]; do
    sleep "$WAIT_STEP"
    i=$((i + 1))
    h=$(health) || return 0
    set -- $h
    [ "$3" -eq 0 ] && { say "对局已全部结束"; return 0; }
  done
  say "等满 30 分钟仍有 ${3} 局，强制重启（剩余对局收到关闭码 1001）"
}

# 重启后 30 秒内，健康检查须返回 current 的版本号与提交号（OPS-046）
restarted() {
  want=$(linked current)
  commit=$(commit_of "$want")
  systemctl restart yi
  i=0
  while [ "$i" -lt "$HEALTH_POLLS" ]; do
    sleep 1
    i=$((i + 1))
    h=$(health) || continue
    set -- $h
    [ "$1" = "$want" ] && [ "$2" = "$commit" ] && return 0
  done
  return 1
}

# current 与 previous 互换（回滚）
swap() {
  cur=$(linked current) prev=$(linked previous)
  [ -n "$prev" ] && [ -d "$ROOT/releases/$prev" ] || return 1
  ln -sfn "releases/$cur" "$ROOT/previous"
  ln -sfn "releases/$prev" "$ROOT/current"
}

# 重启并检查；不通过时自动回滚到上一版本，写 deploy.rolled-back 日志（OPS-046）。$1 为部署日志中的操作名
finish() {
  ver=$(linked current)
  drain
  if restarted; then
    record "$1" "$ver" ok
    say "✓ $ver 已上线，健康检查通过"
    start_watch "$ver"
    return 0
  fi
  auto_rollback "$1" "$ver" healthz "重启后 30 秒内健康检查没有返回 ${ver}"
}

# 自动回滚到上一版本（OPS-046、OPS-047）：写 deploy.rolled-back 日志与部署日志后以非零退出。
# $1 为部署日志中的操作名，$2 为出问题的版本，$3 为原因代码（healthz、restarts、errors），$4 为原因说明
auto_rollback() {
  say "✗ ${4}：自动回滚"
  swap || { record "$1" "$2" fail; fail '没有上一版本可以回滚，请立即查看 journalctl -u yi'; }
  prev=$(linked current)
  printf '{"ts":"%s","level":"error","event":"deploy.rolled-back","msg":"%s，已自动回滚","version":"%s","target":"%s","reason":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$4" "$2" "$prev" "$3" | systemd-cat -t yi-deploy -p err
  if restarted; then r=rolled-back; else r=fail; fi
  record "$1" "$2" "$r"
  [ "$r" = rolled-back ] || fail "回滚到 ${prev} 后仍不正常，请立即查看 journalctl -u yi"
  fail "已回滚到 ${prev}，${2} 留作 previous"
}

# ---------------- 上线后的检查（OPS-047） ----------------

WATCH_DIR=$STATE/watch

# 建立定时器 yi-watch：60 分钟内每分钟以 watch 运行本脚本的一份副本（传上来的临时目录做完即删）。$1 为刚上线的版本
start_watch() {
  stop_watch
  mkdir -p "$WATCH_DIR"
  echo "$(date +%s) $1" >"$WATCH_DIR/started"
  cp "$0" "$ROOT/deploy-remote.sh"
  chmod 644 "$ROOT/deploy-remote.sh"
  systemd-run --unit=yi-watch --collect --on-active=60 --on-unit-active=60 --timer-property=AccuracySec=5s \
    --setenv=YI_OPERATOR=watch --description='Yi post-deploy watch (OPS-047)' sh "$ROOT/deploy-remote.sh" watch >/dev/null
  say "上线后 60 分钟内每分钟检查一次：重启次数、健康检查、错误占比（OPS-047）"
}

# 停止上线后的检查，清除其记录
stop_watch() {
  systemctl stop yi-watch.timer yi-watch.service 2>/dev/null || true
  systemctl reset-failed yi-watch.timer yi-watch.service 2>/dev/null || true
  rm -rf "$WATCH_DIR"
}

# 记下一个样本（“时刻 值”）到 $1，只留最近 WATCH_WINDOW 分钟内的；打出其中最早的值。
# 按时刻而非次数取窗口：某次检查因上线过程持有锁而跳过时，窗口不会因此变长
sample() {
  now=$(date +%s)
  echo "$now $2" >>"$WATCH_DIR/$1"
  awk -v since=$((now - WATCH_WINDOW * 60)) '$1 >= since' "$WATCH_DIR/$1" >"$WATCH_DIR/$1.new"
  mv "$WATCH_DIR/$1.new" "$WATCH_DIR/$1"
  head -n 1 "$WATCH_DIR/$1" | cut -d' ' -f2
}

# 入站消息总数（/metrics 的 yi_messages_total 各项之和）；连不上时打出空串
messages_total() {
  "$NODE" -e 'fetch("http://127.0.0.1:" + process.argv[1] + "/metrics")
    .then(r => (r.ok ? r.text() : Promise.reject(r.status)))
    .then(t => console.log(t.split("\n").filter(l => l.startsWith("yi_messages_total")).reduce((n, l) => n + Number(l.split(" ").pop()), 0)), () => {})' "$PORT" 2>/dev/null || true
}

cmd_watch() {
  [ -f "$WATCH_DIR/started" ] || { stop_watch; return 0; }
  read -r started ver <"$WATCH_DIR/started"
  if [ $(($(date +%s) - started)) -ge "$WATCH_SECS" ] || [ "$(linked current)" != "$ver" ]; then
    stop_watch
    say "上线后的检查结束：$ver"
    return 0
  fi
  restarts=$(systemctl show yi -p NRestarts --value)
  first=$(sample restarts "$restarts")
  if [ $((restarts - first)) -ge "$WATCH_RESTARTS" ]; then stop_watch; auto_rollback watch "$ver" restarts "上线后 5 分钟内重启 $((restarts - first)) 次"; fi
  if health >/dev/null; then echo 0 >"$WATCH_DIR/health-fails"; else
    fails=$(($(cat "$WATCH_DIR/health-fails" 2>/dev/null || echo 0) + 1))
    echo "$fails" >"$WATCH_DIR/health-fails"
    if [ "$fails" -ge "$WATCH_HEALTH_FAILS" ]; then stop_watch; auto_rollback watch "$ver" healthz "上线后健康检查连续 ${fails} 次失败"; fi
  fi
  total=$(messages_total)
  [ -n "$total" ] || return 0
  first=$(sample messages "$total")
  count=$((total - first))
  errors=$(journalctl -u yi --since "@$(($(date +%s) - WATCH_WINDOW * 60))" --no-pager -o cat | grep -c '"event":"internal.error"' || true)
  if [ "$count" -ge "$WATCH_MIN_MESSAGES" ] && [ $((errors * 100)) -ge $((count * WATCH_ERROR_PERCENT)) ]; then
    stop_watch
    auto_rollback watch "$ver" errors "上线后 5 分钟内服务端内部错误 ${errors} 次，占 ${count} 条消息的 1% 以上"
  fi
}

# 检查能否上线 $1：是版本目录的结构、不是线上版本、不低于线上版本（除非 --allow-downgrade）
check_version() {
  [ -L "$ROOT/current" ] || fail "服务器上没有版本目录（$ROOT/current），不是按 OPS-043 部署的结构"
  cur=$(linked current)
  [ "$1" != "$cur" ] || fail "线上已是 $1"
  if version_lt "$1" "$cur" && [ "$2" != 1 ]; then fail "$1 低于线上的 ${cur}，确需降级时加 --allow-downgrade（OPS-042）"; fi
}

cmd_preflight() {
  check_version "$1" "$3"
  free=$(df -Pk "$ROOT" | awk 'NR == 2 { print $4 }')
  [ "$free" -gt $(($2 * 2)) ] || fail "磁盘空间不足：可用 ${free} KB，至少需要 $(($2 * 2)) KB"
  cmd_status
}

cmd_status() {
  if h=$(health); then
    set -- $h
    say "线上 ${1}（${2}）：${3} 局正在进行$([ "$4" = true ] && echo '，维护模式中')"
  else
    say "线上 $(linked current)：连不上健康检查"
  fi
  say "服务器上现在有 $(ss -Htn state established "( sport = :$PORT )" | wc -l | tr -d ' ') 条连接（正在下棋或下载的人）"
}

cmd_install() {
  v=$1 allow=$2 restart=$3
  check_version "$v" "$allow"
  cur=$(linked current)
  # 传到服务器后再核对一次（OPS-031）：不一致即中止，线上的文件保持不动
  (cd "$HERE" && sha256sum --check --ignore-missing --quiet SHA256SUMS) || fail '服务器上的文件与 SHA256SUMS 不符，已中止'
  [ -f "$HERE/yi-server-$v.cjs" ] || fail "没有 yi-server-$v.cjs"
  say '✓ 服务器上的文件与 SHA256SUMS 一致'
  dest=$ROOT/releases/$v
  rm -rf "$dest.new"
  mkdir -p "$dest.new/download"
  mv "$HERE"/Yi-* "$dest.new/download/"
  mv "$HERE/yi-server-$v.cjs" "$dest.new/server.cjs"
  echo "YI_LATEST=$v" >"$dest.new/env"
  chmod 755 "$dest.new" "$dest.new/download"
  chmod 644 "$dest.new/server.cjs" "$dest.new/env" "$dest.new"/download/*
  built=$("$NODE" "$dest.new/server.cjs" --version) || fail '新服务端无法运行，已中止，线上的文件保持不动'
  say "新服务端：$built"
  rm -rf "$dest"
  mv "$dest.new" "$dest"
  ln -sfn "releases/$cur" "$ROOT/previous"
  ln -sfn "releases/$v" "$ROOT/current"
  for d in "$ROOT"/releases/*; do
    n=$(basename "$d")
    [ "$n" = "$v" ] || [ "$n" = "$cur" ] || { rm -rf "$d"; say "删除更早的版本目录 $n"; }
  done
  say "✓ 已换到 ${v}（安装程序、服务端、最新版本号），上一版本 $cur 留作 previous"
  if [ "$restart" = 1 ]; then finish deploy; else
    record deploy "$v" installed
    say "没有重启。挑没人下棋的时候执行：npm run deploy -- restart"
  fi
}

cmd_rollback() {
  stop_watch
  swap || fail '没有上一版本可以换回'
  v=$(linked current)
  say "换回 ${v}，立即重启（不等待对局结束，OPS-044）"
  if restarted; then
    record rollback "$v" ok
    say "✓ 已回滚到 $v"
  else
    record rollback "$v" fail
    fail "回滚到 ${v} 后健康检查不通过，请立即查看 journalctl -u yi"
  fi
}

# 安装 yi.service（SEC-045）：先校验并离线评分，评分高于 SCORE_MAX 时不装；装好后按上线的方式重启（有对局时先进入维护模式）并做健康检查，
# 不通过即恢复原来的文件并再次重启。原文件备份为 /opt/yi/yi.service.prev
cmd_service() {
  new=$HERE/yi.service
  [ -f "$new" ] || fail "没有 $new"
  systemd-analyze verify "$new" || fail 'yi.service 校验不通过，未安装'
  score=$(systemd-analyze security --offline=true --no-pager "$new" | awk '/Overall exposure level/ { print $(NF - 2) }')
  awk -v score="$score" -v max="$SCORE_MAX" 'BEGIN { exit !(score != "" && score + 0 <= max + 0) }' ||
    fail "评分 ${score:-（无）} 高于 ${SCORE_MAX}（SEC-045），未安装"
  say "yi.service 的评分：${score}（上限 ${SCORE_MAX}）"
  cp -p "$UNIT_FILE" "$ROOT/yi.service.prev"
  cp "$new" "$UNIT_FILE"
  chmod 644 "$UNIT_FILE"
  systemctl daemon-reload
  drain
  if restarted; then
    record config 'P1-11 install-service' ok
    say '✓ yi.service 已安装，重启后健康检查通过'
    return 0
  fi
  say '✗ 重启后 30 秒内健康检查没有通过：恢复原来的 yi.service'
  cp -p "$ROOT/yi.service.prev" "$UNIT_FILE"
  systemctl daemon-reload
  if restarted; then r=restored; else r=fail; fi
  record config 'P1-11 install-service' "$r"
  [ "$r" = restored ] || fail '恢复原来的 yi.service 后仍不正常，请立即查看 journalctl -u yi'
  fail '已恢复原来的 yi.service'
}

# 安装异地加密备份（DAT-061 第二层、DAT-063；P1-13）：程序 /opt/yi/offsite.cjs、yi-offsite.service 与 yi-backup.service；
# 传上来 offsite.env 时更新配置（属主 root:yi，权限 640，内含 OSS 的访问密钥，所在的临时目录做完即删）。随后立即上传一次以检查。
# 3.0.0 起两者改为备份数据库（server.cjs backup），线上为 2.x 时装上会使每日备份失败（2026-10-17 曾发生，连续 7 日），故先检查线上版本，不改动任何文件
cmd_offsite() {
  for f in offsite.cjs yi-offsite.service yi-backup.service; do [ -f "$HERE/$f" ] || fail "没有 $f"; done
  [ -L "$ROOT/current" ] || fail "服务器上没有版本目录（$ROOT/current），不是按 OPS-043 部署的结构"
  cur=$(linked current)
  if version_lt "$cur" 3.0.0; then fail "线上为 ${cur}，低于 3.0.0：本版本的异地备份与 yi-backup.service 备份数据库，先上线 3.0.0 再安装；未改动任何文件"; fi
  if [ -f "$HERE/offsite.env" ]; then
    mkdir -p "$ETC"
    chown root:yi "$ETC"
    chmod 750 "$ETC"
    cp "$HERE/offsite.env" "$ETC/offsite.env.new"
    chown root:yi "$ETC/offsite.env.new"
    chmod 640 "$ETC/offsite.env.new"
    mv -f "$ETC/offsite.env.new" "$ETC/offsite.env"
    say "配置已写入 $ETC/offsite.env"
  fi
  [ -f "$ETC/offsite.env" ] || fail "没有 ${ETC}/offsite.env：首次安装须填写存储桶、访问密钥与公钥（不加 --keep-config）"
  cp "$HERE/offsite.cjs" "$ROOT/offsite.cjs"
  cp "$HERE/yi-offsite.service" "$HERE/yi-backup.service" "$SYSTEMD_DIR/"
  chmod 644 "$ROOT/offsite.cjs" "$SYSTEMD_DIR/yi-offsite.service" "$SYSTEMD_DIR/yi-backup.service"
  systemctl daemon-reload
  if systemctl start yi-offsite.service; then r=ok; else r=fail; fi
  journalctl -u yi-offsite -n 3 --no-pager -o cat || true
  record config 'P1-13 install-offsite' "$r"
  [ "$r" = ok ] || fail '首次上传失败，见上面的日志；程序与配置已安装，修正后重新执行 npm run deploy -- install-offsite'
  say '✓ 异地加密备份已安装：每日本地备份成功后上传到 OSS，私钥只在本机'
}

# 以 flock 加锁后再执行一次本脚本（OPS-041）；锁被占用时报告后退出
locked() {
  if [ "${YI_LOCKED:-}" = 1 ]; then return 0; fi
  rc=0
  YI_LOCKED=1 flock -n -E "$LOCK_BUSY" "$LOCK" sh "$0" "$@" || rc=$?
  # 上线后的检查遇到正在进行的上线时跳过这一次
  if [ "$rc" -eq "$LOCK_BUSY" ] && [ "$1" = watch ]; then exit 0; fi
  [ "$rc" -ne "$LOCK_BUSY" ] || fail "另一个上线过程正在进行（${LOCK}），稍后再试"
  exit "$rc"
}

# ---------------- 部署用户（SEC-044） ----------------

# 以发起 sudo 的用户的身份执行命令：读上传目录时只能读到该用户本来就能读的文件，符号链接与硬链接都无从借用 root 的权限
as_uploader() { runuser -u "$UPLOADER" -- "$@"; }

# 部署用户上传文件的目录：其主目录下的 incoming/
upload_root() { printf '%s/incoming' "${YI_UPLOAD_ROOT_HOME:-$(getent passwd "$UPLOADER" | cut -d: -f6)}"; }

# 收取部署用户上传到 $1（须为 upload_root 下的 run.XXXXXX）的安装程序、服务端与 SHA256SUMS：以其身份逐个读出，
# 写入 root 所有的临时目录，此后只用这份副本（HERE 改指向它，做完即删）；随后删除上传目录
receive() {
  [ -n "$UPLOADER" ] || fail '--from= 只用于部署用户经 sudo 上线'
  up=$(upload_root)
  case "$1" in "$up"/run.*) ;; *) fail "上传目录须在 $up/ 下：$1" ;; esac
  case "${1#"$up"/}" in *[!A-Za-z0-9.]*) fail "上传目录的名称不合规：$1" ;; esac
  mkdir -p "$ROOT/.incoming"
  chmod 700 "$ROOT/.incoming"
  HERE=$(mktemp -d "$ROOT/.incoming/recv.XXXXXX")
  trap 'rm -rf "$HERE"' EXIT
  for f in $(as_uploader ls -A -- "$1"); do
    case "$f" in Yi-* | yi-server-*.cjs | SHA256SUMS) ;; *) continue ;; esac
    case "$f" in *[!A-Za-z0-9._-]*) fail "文件名不合规：$f" ;; esac
    as_uploader cat -- "$1/$f" >"$HERE/$f" || fail "读不出上传的 $f"
  done
  as_uploader rm -rf -- "$1"
}

# 经 sudo 由部署用户执行时，只允许日常的上线命令；其余命令安装以 root 身份运行的配置，须以 root 执行（SEC-044）
restrict() {
  [ -n "$UPLOADER" ] || return 0
  case "$1" in preflight | install | restart | rollback | status) ;; *) fail "部署用户不能执行 ${1}：须以 root 执行（SEC-044）" ;; esac
}

# 建立部署用户 deploy（SEC-044）：不设口令，只放入 root 的 Ed25519 公钥，加入 systemd-journal 组以查看日志；
# 本脚本安装为 root 所有的 ${BIN}，sudo 白名单以 visudo 校验通过后才放入 ${SUDOERS}。重复执行即更新为仓库中的版本
cmd_deploy_user() {
  [ -f "$HERE/sudoers-yi-deploy" ] || fail "没有 $HERE/sudoers-yi-deploy"
  keys=$(grep '^ssh-ed25519 ' "$ROOT_KEYS") || fail "$ROOT_KEYS 中没有 Ed25519 公钥"
  getent passwd "$DEPLOY_USER" >/dev/null || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
  usermod -a -G systemd-journal "$DEPLOY_USER"
  home=${YI_UPLOAD_ROOT_HOME:-$(getent passwd "$DEPLOY_USER" | cut -d: -f6)}
  mkdir -p "$home/.ssh" "$home/incoming"
  printf '%s\n' "$keys" >"$home/.ssh/authorized_keys"
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$home/.ssh" "$home/incoming"
  chmod 700 "$home/.ssh" "$home/incoming"
  chmod 600 "$home/.ssh/authorized_keys"
  cp "$HERE/deploy-remote.sh" "$BIN.new"
  chown root:root "$BIN.new"
  chmod 755 "$BIN.new"
  mv -f "$BIN.new" "$BIN"
  cp "$HERE/sudoers-yi-deploy" "$SUDOERS.new"
  chown root:root "$SUDOERS.new"
  chmod 440 "$SUDOERS.new"
  visudo -c -q -f "$SUDOERS.new" || { rm -f "$SUDOERS.new"; record config 'P2-14 install-deploy-user' fail; fail 'sudo 白名单校验不通过，未安装'; }
  mv -f "$SUDOERS.new" "$SUDOERS"
  record config 'P2-14 install-deploy-user' ok
  say "✓ 部署用户 $DEPLOY_USER 已建立：${BIN}、${SUDOERS}；以 ssh ${DEPLOY_USER}@服务器 sudo -l 查看白名单"
}

# 经本机的 Caddy 以 HTTPS 访问弈的站点：下载页面 200、/healthz 被屏蔽为 404 即为正常（API-061）
site_ok() {
  page=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$SITE:443:127.0.0.1" "https://$SITE/" || true)
  internal=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$SITE:443:127.0.0.1" "https://$SITE/healthz" || true)
  [ "$page" = 200 ] && [ "$internal" = 404 ]
}

# 安装 yi.caddy（路线图第 6 章）：Caddy 与主配置由 LightsWeb 仓库安装，主配置须 import $CADDY_SITES/*.caddy。
# 放入后以整套配置校验，通过才平滑重载（不中断其他网站，也不断开已建立的联机）；重载后 SITE_POLLS 秒内经 HTTPS 检查通过即完成，
# 否则恢复原来的文件（没有则删除）并再次重载。原文件在检查期间备份为 yi.caddy.prev
cmd_caddy() {
  new=$HERE/yi.caddy
  dest=$CADDY_SITES/yi.caddy
  [ -f "$new" ] || fail "没有 $new"
  command -v caddy >/dev/null 2>&1 || fail '服务器上没有 Caddy：先按 LightsWeb 仓库安装 Caddy 与主配置'
  grep -qF "import $CADDY_SITES/*.caddy" "$CADDYFILE" 2>/dev/null ||
    fail "$CADDYFILE 中没有 import $CADDY_SITES/*.caddy：先按 LightsWeb 仓库安装主配置"
  mkdir -p "$CADDY_SITES"
  if [ -f "$dest" ]; then cp -p "$dest" "$dest.prev"; else rm -f "$dest.prev"; fi
  cp "$new" "$dest"
  chmod 644 "$dest"
  if ! caddy validate --config "$CADDYFILE" --adapter caddyfile; then
    restore_site "$dest"
    fail 'Caddy 的配置校验不通过，未安装'
  fi
  if systemctl reload caddy; then
    i=0
    while [ "$i" -lt "$SITE_POLLS" ]; do
      if site_ok; then
        rm -f "$dest.prev"
        record config 'stage-4 install-caddy' ok
        say "✓ $dest 已安装：https://$SITE/ 可以访问，/healthz 已屏蔽"
        return 0
      fi
      i=$((i + 1))
      sleep 1
    done
    say "✗ 重载后 ${SITE_POLLS} 秒内 https://$SITE/ 检查没有通过：恢复原来的配置"
  else
    say '✗ Caddy 重载失败：恢复原来的配置'
  fi
  restore_site "$dest"
  if systemctl reload caddy; then r=restored; else r=fail; fi
  record config 'stage-4 install-caddy' "$r"
  fail "已恢复原来的配置（Caddy 重载：${r}）；请查看 journalctl -u caddy"
}

# 恢复 $1 安装前的内容：有备份则换回，没有则删除
restore_site() {
  if [ -f "$1.prev" ]; then mv "$1.prev" "$1"; else rm -f "$1"; fi
}

cmd=${1:-}
[ $# -gt 0 ] && shift
restrict "$cmd"
allow=0 restart=1 from=
for a in "$@"; do
  case "$a" in
    --allow-downgrade) allow=1 ;;
    --no-restart) restart=0 ;;
    --from=*) from=${a#--from=} ;;
  esac
done
# 部署用户上线时，文件来自其上传目录（不能用与本脚本同目录的文件）
if [ "$cmd" = install ] && [ -n "$UPLOADER" ] && [ -z "$from" ]; then fail '部署用户上线须以 --from= 指定上传目录'; fi
case "$cmd" in
  preflight) cmd_preflight "$1" "$2" "$allow" ;;
  status) cmd_status ;;
  install) locked install "$@" && { [ -z "$from" ] || receive "$from"; } && cmd_install "$1" "$allow" "$restart" ;;
  restart) locked restart "$@" && finish restart ;;
  rollback) locked rollback "$@" && cmd_rollback ;;
  service) locked service "$@" && cmd_service ;;
  offsite) locked offsite "$@" && cmd_offsite ;;
  watch) locked watch "$@" && cmd_watch ;;
  caddy) locked caddy "$@" && cmd_caddy ;;
  deploy-user) locked deploy-user "$@" && cmd_deploy_user ;;
  *) fail "用法：sh deploy-remote.sh preflight|install|restart|rollback|status|service|offsite|watch|caddy|deploy-user" ;;
esac
