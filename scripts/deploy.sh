#!/bin/sh
# 上线：把 GitHub 上已发布的某个版本放到服务器上（发版的最后一步，见 docs/procedures/release.md 第 6 章；规则见 OPS-040 至 OPS-052）
#   npm run deploy -- 2.0.5                    上线这一版，再问要不要立即重启
#   npm run deploy -- 2.0.5 --restart          不问，直接重启
#   npm run deploy -- 2.0.5 --allow-downgrade  版本低于线上时须加（OPS-042）
#   npm run deploy -- restart                  重启以完成上线（上线时选了不重启）
#   npm run deploy -- rollback                 立即换回上一版本并重启（再执行一次又换回来）
#   npm run deploy -- migrate-layout           服务器由旧的目录结构改为版本目录（只做一次，不重启）
#   npm run deploy -- status                   查看线上的版本、对局数、是否维护中与连接数（健康检查，API-061）
#   npm run deploy -- install-service          安装或更新 scripts/server/yi.service（加固选项见 SEC-045），重启并检查，不通过即恢复原文件
#   npm run deploy -- install-offsite          安装异地加密备份（P1-13）：询问 OSS 的存储桶、地域、访问密钥与 age 公钥，立即上传一次；
#                                              加 --keep-config 时不询问，只更新程序与单元文件
#   npm run deploy -- install-backup           安装或更新每日备份（scripts/server/ 下的脚本与定时器），并立即备份一次；不重启服务端
#   npm run deploy -- install-journald         安装或更新 journald 的保留策略（scripts/server/journald-yi.conf），重启 journald；不重启服务端
# 安装程序和服务端都取自同一个 Release 的附件，与标签上的代码一一对应；下载后与传到服务器后各按 Release 的 SHA256SUMS 核对一次（OPS-031）。
# 服务器上的步骤在 scripts/server/deploy-remote.sh：加锁、版本目录、维护模式、健康检查与自动回滚、部署日志（OPS-041 至 OPS-048）。
set -eu
SERVER=${YI_SERVER_SSH:-root@47.108.181.240}
DIR=/opt/yi
fail() { echo "✗ $1" >&2; exit 1; }

# 文件的 SHA-256（十六进制）
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

# 核对目录 $1 中每个安装程序与服务端的 SHA-256 与同一目录下的 SHA256SUMS 一致（OPS-031）；
# 任一文件不在 SHA256SUMS 中或不一致即返回非零，并打出是哪个文件
verify_sums() {
  [ -f "$1/SHA256SUMS" ] || { echo "✗ 没有 SHA256SUMS" >&2; return 1; }
  for f in "$1"/Yi-* "$1"/yi-server-*.cjs; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    want=$(awk -v name="$name" '$2 == name { print $1 }' "$1/SHA256SUMS")
    [ -n "$want" ] || { echo "✗ SHA256SUMS 中没有 $name" >&2; return 1; }
    got=$(sha256 "$f")
    [ "$got" = "$want" ] || { echo "✗ ${name} 的 SHA-256 不符：应为 ${want}，实为 ${got}" >&2; return 1; }
  done
}

# 测试只载入上面的函数（tests/deploy.test.ts）
if [ "${YI_DEPLOY_LIB:-}" = 1 ]; then return 0; fi

HERE=$(dirname "$0")/server
# 部署日志中的操作者：只留字母、数字与 ._-
WHO=$(printf %s "${YI_OPERATOR:-$(git config user.name || echo unknown)}" | tr -c 'A-Za-z0-9._-' _)

# 把 deploy-remote.sh 连同其余文件（$2 起）传到服务器 .incoming/ 下的临时目录，再执行其中的命令 $1（含参数）；
# 以 nohup 执行，ssh 断开后照常做完。脚本做完即删除该目录
remote() {
  cmd=$1
  shift
  in=$(ssh "$SERVER" "mkdir -p $DIR/.incoming && mktemp -d $DIR/.incoming/run.XXXXXX")
  scp -q "$HERE/deploy-remote.sh" "$@" "$SERVER:$in/"
  ssh "$SERVER" "YI_OPERATOR=$WHO nohup sh $in/deploy-remote.sh $cmd 2>&1"
}

# 询问异地备份的配置，写入 $1（权限 600）；访问密钥的输入不回显
ask_config() {
  (umask 077 && : >"$1")
  for item in 'YI_OSS_BUCKET 存储桶名称' 'YI_OSS_REGION 存储桶所在的地域（如 cn-hangzhou）' 'YI_OSS_ACCESS_KEY_ID AccessKey ID' \
    'YI_OSS_ACCESS_KEY_SECRET AccessKey Secret（输入时不显示）' 'YI_AGE_RECIPIENT age 公钥（npm run offsite -- keygen 打出的 age1…）'; do
    name=${item%% *}
    printf '%s：' "${item#* }"
    [ "$name" != YI_OSS_ACCESS_KEY_SECRET ] || stty -echo 2>/dev/null || true
    read -r value || value=
    [ "$name" != YI_OSS_ACCESS_KEY_SECRET ] || { stty echo 2>/dev/null || true; echo; }
    printf '%s=%s\n' "$name" "$value" >>"$1"
  done
}

case "${1:-}" in
  rollback | restart | status)
    remote "$1"
    exit 0
    ;;
  migrate-layout)
    remote migrate
    exit 0
    ;;
  install-service)
    remote service "$HERE/yi.service"
    exit 0
    ;;
  install-offsite)
    npm run -s build:node >/dev/null
    set -- "$(dirname "$0")/../dist-server/offsite.cjs" "$HERE/yi-offsite.service" "$HERE/yi-backup.service" "${2:-}"
    if [ "$4" != --keep-config ]; then
      CONF=$(mktemp -d)
      trap 'rm -rf "$CONF"' EXIT
      ask_config "$CONF/offsite.env"
      set -- "$1" "$2" "$3" "$CONF/offsite.env"
    else
      set -- "$1" "$2" "$3"
    fi
    remote offsite "$@"
    exit 0
    ;;
esac

if [ "${1:-}" = install-backup ]; then
  # 每日本地备份（DAT-060、DAT-061、DAT-064；整改项 P0-02）。重复执行即更新为仓库中的版本
  ssh "$SERVER" "mkdir -p $DIR/.incoming"
  scp -q "$HERE/backup.sh" "$HERE/yi-backup.service" "$HERE/yi-backup.timer" "$SERVER:$DIR/.incoming/"
  ssh "$SERVER" "set -e; cd $DIR/.incoming
    install -o root -g root -m 755 backup.sh $DIR/backup.sh
    install -o root -g root -m 644 yi-backup.service yi-backup.timer /etc/systemd/system/
    cd $DIR && rm -r .incoming
    systemctl daemon-reload
    systemctl enable --now yi-backup.timer
    if systemctl start yi-backup.service; then r=ok; else r=fail; fi
    journalctl -u yi-backup -n 2 --no-pager -o cat
    systemctl list-timers yi-backup.timer --no-pager | head -2
    echo \"\$(date -u +%Y-%m-%dT%H:%M:%SZ) $WHO config P0-02 install-backup \$r\" >> /var/lib/yi/deploy.log
    test \$r = ok"
  echo "✓ 每日备份已安装：/opt/yi/backup.sh，定时器 yi-backup.timer；备份在 /var/lib/yi/backup/"
  exit 0
fi

if [ "${1:-}" = install-journald ]; then
  # journald 的保留策略（OPS-065；整改项 P1-08）。重复执行即更新为仓库中的版本。
  # 重启 journald 不会中断服务端：journald 以描述符存储（FileDescriptorStoreMax）保留各服务标准输出的连接。
  # 重启失败时恢复原来的配置（没有则删除）并再次重启，记为 fail
  CONF=/etc/systemd/journald.conf.d/yi.conf
  ssh "$SERVER" "mkdir -p $DIR/.incoming"
  scp -q "$HERE/journald-yi.conf" "$SERVER:$DIR/.incoming/"
  ssh "$SERVER" "set -e
    if test -f $CONF; then cp -p $CONF $CONF.prev; else rm -f $CONF.prev; fi
    install -D -o root -g root -m 644 $DIR/.incoming/journald-yi.conf $CONF && rm -r $DIR/.incoming
    if systemctl restart systemd-journald; then r=ok; else
      r=fail
      if test -f $CONF.prev; then mv $CONF.prev $CONF; else rm -f $CONF; fi
      systemctl restart systemd-journald || true
    fi
    rm -f $CONF.prev
    systemd-analyze cat-config systemd/journald.conf | grep -E '^(SystemMaxUse|MaxRetentionSec)=' || echo '（未设置保留策略）'
    journalctl --disk-usage
    echo \"服务端：\$(systemctl is-active yi)\"
    echo \"\$(date -u +%Y-%m-%dT%H:%M:%SZ) $WHO config P1-08 install-journald \$r\" >> /var/lib/yi/deploy.log
    test \$r = ok"
  echo "✓ journald 的保留策略已安装：${CONF}（总量至多 1 GB，保留 90 日）"
  exit 0
fi

V=${1:-}
echo "$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail '用法：npm run deploy -- 版本号 [--restart] [--allow-downgrade]，或 npm run deploy -- restart、rollback、status、migrate-layout、install-service、install-offsite、install-backup、install-journald'
shift
ALLOW=
RESTART=
for a in "$@"; do
  case "$a" in
    --allow-downgrade) ALLOW=--allow-downgrade ;;
    --restart) RESTART=y ;;
    *) fail "不认识的参数：$a" ;;
  esac
done
draft=$(gh release view "v$V" --json isDraft -q .isDraft 2>/dev/null) || fail "GitHub 上没有 v$V 这个 Release"
[ "$draft" = false ] || fail "v$V 还是草稿，先在网页上确认并发布：gh release view v$V --web"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
gh release download "v$V" -D "$TMP" -p 'Yi-*' -p 'yi-server-*.cjs' -p SHA256SUMS
[ -f "$TMP/yi-server-$V.cjs" ] || fail "Release 里没有 yi-server-$V.cjs"
[ -f "$TMP/SHA256SUMS" ] || fail "v$V 的 Release 里没有 SHA256SUMS（2.0.5 起附带），无法核对下载的文件（OPS-031）"
ls -l "$TMP"
verify_sums "$TMP" || fail '下载的文件与 SHA256SUMS 不符，已中止，服务器未改动'
echo "✓ 下载的文件与 SHA256SUMS 一致"

# 上传前先检查：目录结构、版本（OPS-042）、磁盘空间，并看线上有没有人在下棋
remote "preflight $V $(du -sk "$TMP" | cut -f1) $ALLOW"
if [ -z "$RESTART" ]; then
  printf '上线后立即重启吗？有对局时先进入维护模式，等对局结束（至多 30 分钟）再重启 (y/N) '
  read -r answer || answer=n
  case "$answer" in y | Y) RESTART=y ;; esac
fi
remote "install $V $ALLOW $([ "$RESTART" = y ] || echo --no-restart)" "$TMP"/Yi-* "$TMP/SHA256SUMS" "$TMP/yi-server-$V.cjs"
