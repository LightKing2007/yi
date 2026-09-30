/** 段位分存到一个 JSON 文件（改动后 2 秒内写盘，先写临时文件再改名，断电也不会写坏） */
import fs from 'node:fs';
import type { Ratings } from '../src/shared/protocol';
import type { RatingStore } from './rooms';

export class FileStore implements RatingStore {
  private data: Record<string, { name: string; ratings: Ratings }> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private file: string) {
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 第一次运行 */ }
  }

  get(key: string) { return this.data[key]?.ratings; }

  set(key: string, ratings: Ratings, name: string) {
    this.data[key] = { name, ratings: JSON.parse(JSON.stringify(ratings)) };
    this.timer ??= setTimeout(() => this.flush(), 2000);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
