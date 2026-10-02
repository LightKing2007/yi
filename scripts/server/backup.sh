#!/bin/sh
# 段位存档的每日本地备份，在服务器上由 yi-backup.timer 每天运行一次（以用户 yi 运行）。
# 实现 DAT-060（RPO ≤ 24 小时）、DAT-061 的第一层（本地 /var/lib/yi/backup/，保留 7 份）、DAT-064（每份附 SHA-256，失败写 error 日志）；整改项 P0-02。
# 异地备份为 DAT-061 的第二层，见整改项 P1-13。安装：npm run deploy -- install-backup。
#
# 存档由服务端以“写临时文件再改名”的方式整体替换，cp 读到的总是某一版完整的文件；复制后再解析一次 JSON 确认。
# 输出行首的 <3>、<6> 是 systemd 的日志级别前缀（error、info），journalctl -p err 可以单独筛出失败。
#
# 环境变量（均有默认值，测试时可改）：
#   YI_DATA          存档路径
#   YI_BACKUP_DIR    备份目录
#   YI_BACKUP_KEEP   保留份数
#   YI_NODE          用来校验 JSON 的 node
set -eu
DATA=${YI_DATA:-/var/lib/yi/yi-ratings.json}
DIR=${YI_BACKUP_DIR:-/var/lib/yi/backup}
KEEP=${YI_BACKUP_KEEP:-7}
NODE=${YI_NODE:-/opt/node/bin/node}

umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="yi-ratings-$stamp.json"
tmp="$DIR/.$name.tmp"

fail() { echo "<3>段位存档备份失败：$1" >&2; rm -f "$tmp"; exit 1; }

case "$KEEP" in ''|*[!0-9]*|0) fail "YI_BACKUP_KEEP 应为正整数，现在是 $KEEP" ;; esac
mkdir -p "$DIR" || fail "无法创建备份目录 $DIR"
if [ ! -e "$DATA" ]; then
  echo "<6>存档 $DATA 还不存在（尚无排位记录），本次不备份"
  exit 0
fi

cp "$DATA" "$tmp" || fail "无法复制 $DATA"
"$NODE" -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$tmp" 2>/dev/null \
  || fail "复制出的文件无法解析为 JSON，存档本身可能已损坏，请立即检查 $DATA"
mv "$tmp" "$DIR/$name" || fail "无法写入 $DIR/$name"
(cd "$DIR" && sha256sum "$name" > "$name.sha256" && sha256sum -c --quiet "$name.sha256") || fail "无法生成或核对 $name 的校验和"
sync "$DIR/$name" "$DIR/$name.sha256" 2>/dev/null || sync

# 只保留最新的 KEEP 份（文件名中的时间可按字典序排序），连同各自的校验和
count=$(ls "$DIR" | grep -c '^yi-ratings-.*\.json$' || true)
if [ "$count" -gt "$KEEP" ]; then
  ls "$DIR" | grep '^yi-ratings-.*\.json$' | sort | head -n $((count - KEEP)) | while read -r old; do
    rm -f "$DIR/$old" "$DIR/$old.sha256"
  done
fi

size=$(wc -c < "$DIR/$name" | tr -d ' ')
sum=$(cut -c1-16 "$DIR/$name.sha256")
echo "<6>段位存档已备份到 $DIR/$name（$size 字节，SHA-256 $sum…），共保留 $(ls "$DIR" | grep -c '^yi-ratings-.*\.json$') 份"
