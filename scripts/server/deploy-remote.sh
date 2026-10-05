#!/bin/sh
# 上线在服务器上的部分：由 scripts/deploy.sh 连同要上线的文件传到 /opt/yi/.incoming/ 下的临时目录后执行，做完即删除该目录。
#   sh deploy-remote.sh preflight 版本号 所需KB [--allow-downgrade]   上线前检查（目录结构、版本、磁盘空间），并打出线上状态
#   sh deploy-remote.sh install 版本号 [--allow-downgrade] [--no-restart] 建版本目录、切换、重启并检查，不通过即自动回滚
#   sh deploy-remote.sh restart                                         重启（有对局时先进入维护模式），不通过即自动回滚
#   sh deploy-remote.sh rollback                                        立即换回上一版本并重启（再执行一次又换回来）
#   sh deploy-remote.sh migrate                                         由旧的目录结构改为版本目录（只做一次，不重启）
#   sh deploy-remote.sh status                                          打出线上的版本、对局数、是否维护中与连接数
#   sh deploy-remote.sh service                                         安装同目录下的 yi.service（SEC-045），重启并检查，不通过即恢复原文件
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
WHO=${YI_OPERATOR:-unknown}
WAIT_STEP=10     # 维护模式中每 10 秒查一次活跃对局数
WAIT_POLLS=180   # 至多 180 次，即 30 分钟（OPS-045）
HEALTH_POLLS=30  # 重启后每秒查一次健康检查，至多 30 秒（OPS-046）
SCORE_MAX=4.0    # systemd-analyze security 的评分上限（SEC-045）
LOCK_BUSY=75     # flock 拿不到锁时的退出码
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

# 健康检查（API-061）：打出“版本号 提交号 活跃对局数 是否维护中”；连不上或没有 /healthz（2.0.4 及以前）时返回非零
health() {
  "$NODE" -e 'fetch("http://127.0.0.1:" + process.argv[1] + "/healthz")
    .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(h => console.log(h.version, h.commit, h.games, h.maintenance), () => process.exit(1))' "$PORT" 2>/dev/null
}

# 符号链接 $1（current 或 previous）指向的版本号；没有时为空
linked() { if [ -L "$ROOT/$1" ]; then basename "$(readlink "$ROOT/$1")"; fi; }

# 版本目录 $1 中服务端的提交号（server.cjs --version 打出“版本号（提交号）”）
commit_of() { "$NODE" "$ROOT/releases/$1/server.cjs" --version | sed 's/.*（\(.*\)）.*/\1/'; }

# 有活跃对局时进入维护模式，等对局结束，至多 30 分钟（OPS-045）。线上版本没有健康检查时不发信号：
# 2.0.4 及以前的服务端没有处理 SIGUSR2，收到即退出
drain() {
  h=$(health) || { say "线上的服务端没有健康检查，无法得知对局数，直接重启"; return 0; }
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

# 回滚后的检查：上一版本若没有健康检查（2.0.4 及以前），以服务处于运行状态为准
rolled_back() {
  restarted && return 0
  health >/dev/null && return 1
  sleep 1
  systemctl is-active --quiet yi && say "（上一版本没有健康检查，以服务处于运行状态为准）"
}

# 重启并检查；不通过时自动回滚到上一版本，写 deploy.rolled-back 日志（OPS-046）。$1 为部署日志中的操作名
finish() {
  ver=$(linked current)
  drain
  if restarted; then
    rm -rf "$ROOT/server.cjs" "$ROOT/server.cjs.prev" "$ROOT/download" # 旧的目录结构留下的文件（migrate 之后的第一次上线）
    record "$1" "$ver" ok
    say "✓ $ver 已上线，健康检查通过"
    return 0
  fi
  say "✗ 重启后 30 秒内健康检查没有返回 ${ver}：自动回滚"
  swap || { record "$1" "$ver" fail; fail '没有上一版本可以回滚，请立即查看 journalctl -u yi'; }
  prev=$(linked current)
  printf '{"ts":"%s","level":"error","event":"deploy.rolled-back","msg":"上线后健康检查不通过，已自动回滚","version":"%s","target":"%s","reason":"healthz"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$ver" "$prev" | systemd-cat -t yi-deploy -p err
  if rolled_back; then r=rolled-back; else r=fail; fi
  record "$1" "$ver" "$r"
  [ "$r" = rolled-back ] || fail "回滚到 ${prev} 后仍不正常，请立即查看 journalctl -u yi"
  fail "已回滚到 ${prev}，${ver} 留作 previous"
}

# 检查能否上线 $1：已改为版本目录、不是线上版本、不低于线上版本（除非 --allow-downgrade）
check_version() {
  [ -L "$ROOT/current" ] || fail '服务器还是旧的目录结构，先执行 npm run deploy -- migrate-layout'
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
    say "线上 $(linked current)：没有健康检查"
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
  swap || fail '没有上一版本可以换回'
  v=$(linked current)
  say "换回 ${v}，立即重启（不等待对局结束，OPS-044）"
  if rolled_back; then
    record rollback "$v" ok
    say "✓ 已回滚到 $v"
  else
    record rollback "$v" fail
    fail "回滚到 ${v} 后健康检查不通过，请立即查看 journalctl -u yi"
  fi
}

# 改为版本目录：当前的服务端与安装程序复制为 releases/版本号/，YI_LATEST 移入其中的 env；
# yi.service 改为经 current 读取三者，下一次重启起生效。原来的文件在下一次上线成功后删除
cmd_migrate() {
  [ ! -e "$ROOT/current" ] || fail '已是版本目录的结构'
  [ -f "$ROOT/server.cjs" ] && [ -d "$ROOT/download" ] || fail "没有 $ROOT/server.cjs 或 $ROOT/download/"
  built=$("$NODE" "$ROOT/server.cjs" --version)
  v=${built%%（*}
  latest=$(sed -n 's/^Environment=YI_LATEST=//p' "$UNIT_FILE")
  [ -n "$latest" ] || fail "$UNIT_FILE 中没有 YI_LATEST"
  awk '
    /^Environment=YI_LATEST=/ { next }
    /^Environment=YI_FILES=/ { print "Environment=YI_FILES=/opt/yi/current/download"; next }
    /^ExecStart=/ { sub(/ \/opt\/yi\/server\.cjs/, " /opt/yi/current/server.cjs"); print; print "EnvironmentFile=/opt/yi/current/env"; next }
    { print }' "$UNIT_FILE" >"$UNIT_FILE.new"
  grep -q '^ExecStart=.* /opt/yi/current/server\.cjs' "$UNIT_FILE.new" && grep -q '^Environment=YI_FILES=/opt/yi/current/download$' "$UNIT_FILE.new" ||
    { rm -f "$UNIT_FILE.new"; fail "$UNIT_FILE 的 ExecStart 或 YI_FILES 与预期不符，未改动"; }
  dest=$ROOT/releases/$v
  rm -rf "$dest.new"
  mkdir -p "$ROOT/releases" "$dest.new"
  cp -p "$ROOT/server.cjs" "$dest.new/server.cjs"
  cp -pR "$ROOT/download" "$dest.new/download"
  echo "YI_LATEST=$latest" >"$dest.new/env"
  mv "$dest.new" "$dest"
  ln -sfn "releases/$v" "$ROOT/current"
  cp -p "$UNIT_FILE" "$ROOT/yi.service.before-migrate"
  diff -u "$UNIT_FILE" "$UNIT_FILE.new" || true
  mv "$UNIT_FILE.new" "$UNIT_FILE"
  systemctl daemon-reload
  record config 'P1-09 migrate-layout' ok # 与 install-backup 等配置修改的记录格式一致
  say "✓ 已改为版本目录：current → releases/${v}；yi.service 下一次重启起生效（原文件备份为 $ROOT/yi.service.before-migrate）"
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
  if rolled_back; then r=restored; else r=fail; fi
  record config 'P1-11 install-service' "$r"
  [ "$r" = restored ] || fail '恢复原来的 yi.service 后仍不正常，请立即查看 journalctl -u yi'
  fail '已恢复原来的 yi.service'
}

# 以 flock 加锁后再执行一次本脚本（OPS-041）；锁被占用时报告后退出
locked() {
  if [ "${YI_LOCKED:-}" = 1 ]; then return 0; fi
  rc=0
  YI_LOCKED=1 flock -n -E "$LOCK_BUSY" "$LOCK" sh "$0" "$@" || rc=$?
  [ "$rc" -ne "$LOCK_BUSY" ] || fail "另一个上线过程正在进行（${LOCK}），稍后再试"
  exit "$rc"
}

cmd=${1:-}
[ $# -gt 0 ] && shift
allow=0 restart=1
for a in "$@"; do
  case "$a" in
    --allow-downgrade) allow=1 ;;
    --no-restart) restart=0 ;;
  esac
done
case "$cmd" in
  preflight) cmd_preflight "$1" "$2" "$allow" ;;
  status) cmd_status ;;
  install) locked install "$@" && cmd_install "$1" "$allow" "$restart" ;;
  restart) locked restart "$@" && finish restart ;;
  rollback) locked rollback "$@" && cmd_rollback ;;
  migrate) locked migrate "$@" && cmd_migrate ;;
  service) locked service "$@" && cmd_service ;;
  *) fail "用法：sh deploy-remote.sh preflight|install|restart|rollback|migrate|status|service" ;;
esac
