#!/bin/sh
# 官网健康后才切换 Caddy；失败恢复原站点配置，游戏进程和数据库始终不在操作范围内。
set -eu
src=$1
root=/opt/www/yi.lightking.com.cn
site=/etc/caddy/sites/yi.caddy
node=/opt/node/bin/node
curl --fail --silent --max-time 5 http://127.0.0.1:8444/healthz | "$node" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{if(JSON.parse(s).service!=="yi-web")process.exit(1)})'
# 首次代理切换可能使旧代理上的连接重新建立；存在对局时拒绝操作。
curl --fail --silent --max-time 5 http://127.0.0.1:8443/healthz | "$node" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{if(JSON.parse(s).games!==0)process.exit(1)})'
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=$root/config-backup/yi.caddy.$stamp
cp -p "$site" "$backup"
restore() {
  cp -p "$backup" "$site"
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy || true
}
trap restore EXIT HUP INT TERM
install -o root -g root -m 644 "$src/yi.caddy" "$site"
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
for route in / /download/ /support /support/black-screen-webgl /agreement /agreement/privacy-policy /agreement/terms-of-service /agreement/minors-privacy-rules; do
  curl --fail --silent --show-error --max-time 10 "https://yi.lightking.com.cn$route" -o /dev/null
done
systemctl enable yi-web
trap - EXIT HUP INT TERM
printf '{"ts":"%s","action":"activate","result":"ok"}\n' "$stamp" >> "$root/deploy.log"
