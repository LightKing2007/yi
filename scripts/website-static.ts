/** 构建时把固定内容写成真正的 HTML；主页、下载页与安装包处理不在此入口。 */
import fs from 'node:fs';
import path from 'node:path';
import { agreementPages } from '../server/agreementPage';
import { notFoundPage } from '../server/notFoundPage';
import { supportPage, supportPages } from '../server/supportPage';

const root = path.resolve('dist-website/site');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });

function write(name: string, body: Buffer | string) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

for (const [route, body] of agreementPages(__APP_VERSION__)) write(`${route}.html`, body);
write('support.html', supportPage(__APP_VERSION__, '', true));
for (const [route, body] of supportPages(__APP_VERSION__)) write(`${route}.html`, body);
write('404.html', notFoundPage(__APP_VERSION__));
