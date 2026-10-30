/** 同步事务与嵌套保存点的真实 SQLite 验证，禁止提前提交外层工作（DAT-040）。 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type DatabaseSync } from 'node:sqlite';
import { MEMORY, openDatabase } from '../server/db';
import { transaction } from '../server/db/transaction';

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(MEMORY, { now: () => 0, appVersion: '3.1.0' });
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY) STRICT');
});
afterEach(() => db.close());
const values = () =>
  db
    .prepare('SELECT id FROM notes ORDER BY id')
    .all()
    .map(row => row.id);

it('外层事务返回结果并提交，成功后不保留未提交事务', () => {
  expect(
    transaction(db, () => {
      db.exec('INSERT INTO notes VALUES (1)');
      return 'ok';
    }),
  ).toBe('ok');
  expect(db.isTransaction).toBe(false);
  expect(values()).toEqual([1]);
});

it('外层失败完整回滚并保留原异常', () => {
  expect(() =>
    transaction(db, () => {
      db.exec('INSERT INTO notes VALUES (1)');
      throw new Error('abort');
    }),
  ).toThrow('abort');
  expect(db.isTransaction).toBe(false);
  expect(values()).toEqual([]);
});

it('内层失败只回滚内层，内层成功也不能提前提交外层', () => {
  transaction(db, () => {
    db.exec('INSERT INTO notes VALUES (1)');
    expect(() =>
      transaction(db, () => {
        db.exec('INSERT INTO notes VALUES (2)');
        throw new Error('nested');
      }),
    ).toThrow('nested');
    transaction(db, () => db.exec('INSERT INTO notes VALUES (3)'));
    expect(db.isTransaction).toBe(true);
  });
  expect(values()).toEqual([1, 3]);
});
