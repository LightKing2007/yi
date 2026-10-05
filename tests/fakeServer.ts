/**
 * 上线脚本测试的替身（tests/deployRemote.test.ts、tests/deployLocal.test.ts）：两份脚本都以 sh 实际执行，
 * systemctl、sleep、flock、Node.js 等换成桩程序，在临时目录中模拟服务器：
 *   - server.cjs 的内容为“版本号 提交号”，桩 Node.js 以“版本号（提交号）”回应 --version；
 *   - systemctl restart 把 current 指向的服务端记为运行中，健康检查据此回应版本号与提交号；yi.service 中有“# BREAK”一行时服务起不来；
 *   - sleep 不等待，只记下次数；设了 drain 时每次把活跃对局数减一，以此模拟时间流逝。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 服务器端脚本 */
export const SCRIPT = path.resolve(__dirname, '../scripts/server/deploy-remote.sh');

let base = '';
/** 模拟的 /opt/yi（opt）、/var/lib/yi（state）、桩程序（bin）与模拟状态（sim）所在的临时目录下的路径 */
export const at = (...parts: string[]) => path.join(base, ...parts);
/** 写文件，目录不存在时先建 */
export const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
/** 读文件，不存在时为空串 */
export const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
/** 文本的 SHA-256（十六进制） */
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** 桩程序：每次调用记一行到 sim/calls */
const STUBS: Record<string, string> = {
  systemctl: `echo "systemctl $*" >> "$SIM/calls"
case "$1" in
  restart) if grep -q '^# BREAK' "$YI_UNIT_FILE" 2>/dev/null; then : > "$SIM/running"; else cat "$ROOT/current/server.cjs" > "$SIM/running"; fi
    echo 0 > "$SIM/maint" ;;
  kill) echo true > "$SIM/maint" ;;
  start) [ ! -f "$SIM/start-fails" ] ;;
  show) cat "$SIM/nrestarts" 2>/dev/null || echo 0 ;;
  is-active) [ -s "$SIM/running" ] ;;
esac`,
  // systemd-analyze：verify 在 sim/verify-fails 存在时失败；security 以 sim/score 为评分
  'systemd-analyze': `echo "systemd-analyze $1" >> "$SIM/calls"
case "$1" in
  verify) [ ! -f "$SIM/verify-fails" ] ;;
  security) echo "→ Overall exposure level for yi.service: $(cat "$SIM/score") OK :-)" ;;
esac`,
  sleep: `echo "sleep $*" >> "$SIM/calls"
if [ -f "$SIM/drain" ]; then n=$(cat "$SIM/games"); [ "$n" -gt 0 ] && echo $((n - 1)) > "$SIM/games"; fi; true`,
  flock: `echo "flock $1 $2 $3 $4" >> "$SIM/calls"
[ -f "$SIM/locked" ] && exit "$3"
shift 4; exec "$@"`,
  'systemd-cat': `echo "systemd-cat $*" >> "$SIM/calls"; cat >> "$SIM/journal"`,
  chown: `echo "chown $*" >> "$SIM/calls"`,
  // journalctl -u yi：sim/yi-journal 中的日志（上线后的检查据此统计 internal.error）
  journalctl: `echo "journalctl $*" >> "$SIM/calls"
[ "$1 $2" = "-u yi" ] && cat "$SIM/yi-journal" 2>/dev/null; true`,
  'systemd-run': `echo "systemd-run $*" >> "$SIM/calls"`,
  // date +%s：sim/now 中的模拟时刻；其余用法交给系统的 date
  date: `if [ "$1" = +%s ]; then cat "$SIM/now"; else exec /bin/date "$@"; fi`,
  ss: `printf 'a\\nb\\nc\\n'`,
  sha256sum: `exec shasum -a 256 "$@"`,
  // 本机脚本所用的 gh、ssh、scp：ssh 在本机执行命令，scp 复制到本机，两者都把 /opt/yi 换成模拟的目录
  gh: `case "$1 $2" in
  "release view") echo false ;;
  "release download") while [ $# -gt 0 ]; do [ "$1" = -D ] && dir=$2; shift; done; cp "$SIM"/release/* "$dir/" ;;
esac`,
  ssh: `exec sh -c "$(printf %s "$2" | sed "s#/opt/yi#$ROOT#g")"`,
  scp: `shift
echo "scp $(($# - 1))" >> "$SIM/calls"
for last; do :; done
dest=$(printf %s "\${last#*:}" | sed "s#/opt/yi#$ROOT#g")
while [ $# -gt 1 ]; do cp "$1" "$dest/"; shift; done`,
  // 桩 Node.js：-e 为健康检查（运行中的版本标记为 broken 时连不上，标记为 nohealth 时没有 /healthz）；否则为 server.cjs --version
  'fake-node': `if [ "$1" = -e ] && printf %s "$2" | grep -q /metrics; then
  [ -f "$SIM/messages" ] || exit 0
  cat "$SIM/messages"
elif [ "$1" = -e ]; then
  [ -s "$SIM/running" ] || exit 1
  set -- $(cat "$SIM/running")
  [ -f "$SIM/broken-$1" ] || [ -f "$SIM/nohealth-$1" ] && exit 1
  echo "$1 $(cat "$SIM/commit-override" 2>/dev/null || echo "$2") $(cat "$SIM/games") $(cat "$SIM/maint")"
else
  set -- $(cat "$1"); echo "$1（$2）"
fi`,
};

/** 在 releases/版本号/ 放一个版本：服务端、安装程序与 env */
export function release(version: string) {
  write(at('opt/releases', version, 'server.cjs'), `${version} c${version.replaceAll('.', '')}`);
  write(at('opt/releases', version, 'download', `Yi-${version}-win-x64-setup.exe`), `win ${version}`);
  write(at('opt/releases', version, 'env'), `YI_LATEST=${version}\n`);
}
/** current（以及 previous）指向的版本，运行中的是 current */
export function layout(current: string, previous?: string) {
  for (const version of [current, previous]) if (version) release(version);
  fs.symlinkSync(`releases/${current}`, at('opt/current'));
  if (previous) fs.symlinkSync(`releases/${previous}`, at('opt/previous'));
  fs.copyFileSync(at('opt/current/server.cjs'), at('sim/running'));
}
/** Release 的附件：安装程序、服务端与 SHA256SUMS，写到 dir；tamper 时改动安装程序的内容 */
export function attachments(version: string, dir: string, tamper = false) {
  const files = {
    [`Yi-${version}-win-x64-setup.exe`]: `win ${version}`,
    [`Yi-${version}-mac-arm64.dmg`]: `mac ${version}`,
    [`yi-server-${version}.cjs`]: `${version} c${version.replaceAll('.', '')}`,
  };
  for (const [name, text] of Object.entries(files)) write(path.join(dir, name), tamper && name.endsWith('.dmg') ? 'tampered' : text);
  const sums = Object.entries(files).map(([name, text]) => `${sha256(text)}  ${name}\n`);
  write(path.join(dir, 'SHA256SUMS'), sums.join('') + `${sha256('sbom')}  yi-sbom-${version}.cdx.json\n`);
}
/** 传到服务器的文件（附件与 deploy-remote.sh），返回其中脚本的路径 */
export function incoming(version: string, tamper = false) {
  attachments(version, at('incoming'), tamper);
  fs.copyFileSync(SCRIPT, at('incoming/deploy-remote.sh'));
  return at('incoming/deploy-remote.sh');
}

/** 以 sh 执行脚本 script（默认为仓库中的脚本），返回退出码与输出（标准输出在前、标准错误在后，不打到终端）；input 为标准输入 */
export function run(args: string[], script = SCRIPT, input = '', operator = 'tester') {
  const env = {
    ...process.env,
    PATH: `${at('bin')}:${process.env.PATH}`,
    SIM: at('sim'),
    ROOT: at('opt'),
    YI_ROOT: at('opt'),
    YI_STATE: at('state'),
    YI_NODE: at('bin/fake-node'), // 不叫 node：PATH 上的 node 须是真的（install-offsite 要打包）
    YI_LOCK: at('lock'),
    YI_UNIT_FILE: at('yi.service'),
    YI_SYSTEMD_DIR: at('systemd'),
    YI_ETC: at('etc-yi'),
    YI_OPERATOR: operator,
  };
  const result = spawnSync('sh', [script, ...args], { env, encoding: 'utf8', input });
  return { code: result.status, out: result.stdout + result.stderr };
}
/** 桩程序依次记下的调用 */
export const calls = () => read(at('sim/calls')).trim().split('\n').filter(Boolean);
/** 对 yi 服务的 systemctl 调用（不含上线后检查 yi-watch 的启停） */
export const serviceCalls = () => calls().filter(line => line.startsWith('systemctl') && !line.includes('yi-watch'));
/** 模拟的 /opt/yi 下符号链接 name 的指向；不存在时为空串 */
export const link = (name: string) => (fs.existsSync(at('opt', name)) ? fs.readlinkSync(at('opt', name)) : '');
/** 部署日志的各行（去掉时间） */
export const deployLog = () =>
  read(at('state/deploy.log'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(' ').slice(1).join(' '));

/** 每项测试前：建临时目录、装桩程序、清零模拟状态 */
export function setupServer() {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-deploy-remote-'));
  for (const [name, body] of Object.entries(STUBS)) {
    write(at('bin', name), `#!/bin/sh\n${body}\n`);
    fs.chmodSync(at('bin', name), 0o755);
  }
  for (const name of ['state', 'systemd']) fs.mkdirSync(at(name), { recursive: true });
  write(at('sim/games'), '0');
  write(at('sim/maint'), 'false');
  write(at('sim/now'), '1000000');
}

/** 每项测试后：删除临时目录 */
export function teardownServer() {
  fs.rmSync(base, { recursive: true, force: true });
}
