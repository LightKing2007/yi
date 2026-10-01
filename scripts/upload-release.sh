#!/bin/sh
# 把 GitHub 上某个版本的安装包传到服务器的下载目录，并把服务端提示的最新版本改成它：
#   scripts/upload-release.sh 2.0.1
# 先传到下载目录里的 .incoming/，传完再移过去，传到一半的文件不会出现在下载页上；旧版本的安装包随后删掉。
# 下载页马上就是新的；客户端的“有新版本”提示要等服务端重启后才生效（重启会中断正在进行的对局，所以这里不自动重启）。
set -eu
V=${1:?用法 scripts/upload-release.sh 版本号}
SERVER=${YI_SERVER_SSH:-root@47.108.181.240}
DIR=/opt/yi/download

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
gh release download "v$V" -D "$TMP" -p 'Yi-*'
ls -l "$TMP"

ssh "$SERVER" "mkdir -p $DIR/.incoming"
scp "$TMP"/Yi-* "$SERVER:$DIR/.incoming/"
ssh "$SERVER" "set -e; cd $DIR
  mv .incoming/Yi-* . && rmdir .incoming
  find . -maxdepth 1 -name 'Yi-*' ! -name 'Yi-$V-*' -print -delete
  sed -i 's/^Environment=YI_LATEST=.*/Environment=YI_LATEST=$V/' /etc/systemd/system/yi.service
  systemctl daemon-reload
  ls -l"
echo "已上传 $V。没人下棋的时候重启服务端，让客户端提示更新：ssh $SERVER systemctl restart yi"
