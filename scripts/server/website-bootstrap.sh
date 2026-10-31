#!/bin/sh
# 初次建立独立官网的服务与部署白名单；不切换公网路由、不重启联机服务。
set -eu
src=$1
root=/opt/www/yi.lightking.com.cn
[ "$(id -u)" = 0 ]
visudo -cf "$src/sudoers-yi-web"
systemd-analyze verify "$src/yi-web.service"
install -d -m 755 "$root" "$root/releases" "$root/config-backup"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
for target in /etc/systemd/system/yi-web.service /etc/sudoers.d/yi-web-deploy /usr/local/lib/yi-web-deploy.cjs /usr/local/sbin/yi-web-deploy; do
  [ ! -e "$target" ] || cp -p "$target" "$root/config-backup/$(printf %s "$target" | tr / _).$stamp"
done
install -o root -g root -m 644 "$src/deploy.cjs" /usr/local/lib/yi-web-deploy.cjs
install -o root -g root -m 755 "$src/yi-web-deploy.sh" /usr/local/sbin/yi-web-deploy
install -o root -g root -m 644 "$src/yi-web.service" /etc/systemd/system/yi-web.service
install -o root -g root -m 440 "$src/sudoers-yi-web" /etc/sudoers.d/yi-web-deploy
systemctl daemon-reload
printf '{"ts":"%s","action":"bootstrap","result":"ok"}\n' "$stamp" >> "$root/deploy.log"
