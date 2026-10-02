#!/bin/sh
# 上线：把 GitHub 上已发布的某个版本放到服务器上（发版的最后一步，见 docs/procedures/release.md 第 6 章；规则见 OPS-040 至 OPS-052）
#   npm run deploy -- 2.0.2             传安装包到下载页、换上这一版的服务端、改最新版本号，再问要不要重启
#   npm run deploy -- 2.0.2 --restart   不问，直接重启
#   npm run deploy -- rollback          服务端换回上一版并重启（再执行一次又换回来）
#   npm run deploy -- install-backup    安装或更新每日备份（scripts/server/ 下的脚本与定时器），并立即备份一次；不重启服务端
# 安装包和服务端都取自同一个 Release 的附件，与标签上的代码一一对应。
# 安装包先传到 .incoming/，传完再移过去，传到一半的文件不会出现在下载页上；旧版本的安装包随后删掉。
set -eu
SERVER=${YI_SERVER_SSH:-root@47.108.181.240}
DIR=/opt/yi
fail() { echo "✗ $1" >&2; exit 1; }

if [ "${1:-}" = rollback ]; then
  ssh "$SERVER" "set -e; cd $DIR
    test -f server.cjs.prev || { echo '✗ 没有上一版可以换回' >&2; exit 1; }
    mv server.cjs server.cjs.swap && mv server.cjs.prev server.cjs && mv server.cjs.swap server.cjs.prev
    systemctl restart yi && sleep 1 && journalctl -u yi -n 1 --no-pager -o cat"
  exit 0
fi

if [ "${1:-}" = install-backup ]; then
  # 每日本地备份（DAT-060、DAT-061、DAT-064；整改项 P0-02）。重复执行即更新为仓库中的版本
  HERE=$(dirname "$0")/server
  WHO=${YI_OPERATOR:-$(git config user.name || echo unknown)}
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

V=${1:-}
echo "$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail '用法：npm run deploy -- 版本号 [--restart]，或 npm run deploy -- rollback、npm run deploy -- install-backup'
draft=$(gh release view "v$V" --json isDraft -q .isDraft 2>/dev/null) || fail "GitHub 上没有 v$V 这个 Release"
[ "$draft" = false ] || fail "v$V 还是草稿，先在网页上确认并发布：gh release view v$V --web"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
gh release download "v$V" -D "$TMP" -p 'Yi-*' -p 'yi-server-*.cjs'
[ -f "$TMP/yi-server-$V.cjs" ] || fail "Release 里没有 yi-server-$V.cjs"
ls -l "$TMP"

ssh "$SERVER" "mkdir -p $DIR/download/.incoming"
scp -q "$TMP"/Yi-* "$SERVER:$DIR/download/.incoming/"
scp -q "$TMP/yi-server-$V.cjs" "$SERVER:$DIR/server.cjs.new"
ssh "$SERVER" "set -e
  cd $DIR/download && mv .incoming/Yi-* . && rmdir .incoming
  find . -maxdepth 1 -name 'Yi-*' ! -name 'Yi-$V-*' -print -delete
  cd $DIR && chmod 644 server.cjs.new
  echo \"新服务端：\$(/opt/node/bin/node server.cjs.new --version)\"
  mv server.cjs server.cjs.prev && mv server.cjs.new server.cjs
  sed -i 's/^Environment=YI_LATEST=.*/Environment=YI_LATEST=$V/' /etc/systemd/system/yi.service
  systemctl daemon-reload"
echo "✓ 下载页已换成 $V，服务端已换好，重启后生效（上一版留作 server.cjs.prev）"

n=$(ssh "$SERVER" "ss -Htn state established '( sport = :8443 )' | wc -l")
echo "服务器上现在有 $n 条连接（正在下棋或下载的人）"
if [ "${2:-}" = --restart ]; then answer=y; else printf '现在重启服务端吗？会中断正在进行的对局 (y/N) '; read -r answer || answer=n; fi
if [ "$answer" = y ] || [ "$answer" = Y ]; then
  ssh "$SERVER" "systemctl restart yi && sleep 1 && journalctl -u yi -n 1 --no-pager -o cat"
  echo "✓ 已重启，客户端会提示更新到 $V"
else
  echo "没有重启。挑没人下棋的时候执行：ssh $SERVER systemctl restart yi"
fi
