#!/bin/sh
# root 所有的独立官网部署入口；sudo 白名单只允许该脚本，不能传入任意 Node 参数。
set -eu
exec flock /run/yi-web-deploy.lock /opt/node/bin/node /usr/local/lib/yi-web-deploy.cjs "$@"
