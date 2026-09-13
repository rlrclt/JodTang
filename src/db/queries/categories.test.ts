/**
 * เทสต์ query layer ของหมวด (categories) — PGlite (Postgres จริงใน WASM)
 * รัน: node --test src/db/queries/categories.test.ts
 *
 * พิสูจน์ 4 ข้อ:
 *   ก) listCategories แบบเดิม "ไม่เปลี่ยนพฤติกรรม" — หมวดที่ archive ยังถูกกรองออก (caller เดิมห้ามพัง)
 *   ข) includeArchived: true → คืนหมวดที่ archive ด้วย พร้อม archivedAt (ป้าย "เลิกใช้แล้ว" บนรายการเก่า)
 *   ค) listCategoriesById คืนเฉพาะของผู้ใช้คนนี้ และคืนหมวดที่ archive ได้ (ชื่อหมวดของรายการเก่า)
 *   ง) listCategoriesById = 1 query เดียวต่อหน้า (ห้าม N+1) และ ids ว่าง = ไม่ยิง query เลย
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import { listCategories, listCategoriesById } from './categories.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'u1';
const U2 = 'u2';
const C = (n: number) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [C_FOOD, C_RENT, C_SALARY, C_U2E] = [1, 2, 3, 4].map(C);
const C_MISSING = C(9);

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`
  insert into "user" (id, name) values ('${U1}', 'Yoru'), ('${U2}', 'Big');
  insert into categories (id, user_id, kind, name, sort_order, archived_at) values
    ('${C_FOOD}',   '${U1}', 'expense', 'อาหาร',    2, null),
    ('${C_RENT}',   '${U1}', 'expense', 'ค่าห้อง',  1, now()),
    ('${C_SALARY}', '${U1}', 'income',  'เงินเดือน', 3, null),
    ('${C_U2E}',    '${U2}', 'expense', 'ของ u2',   1, now());
`);
await pglite.exec('vacuum analyze categories');

const db = drizzle(pglite, { schema }) as unknown as Db;

// นับ query จริงที่วิ่งเข้า PGlite (พิสูจน์ว่าไม่ใช่ N+1)
let queryCount = 0;
const runQuery = pglite.query.bind(pglite);
pglite.query = ((...args: Parameters<typeof runQuery>) => {
  queryCount += 1;
  return runQuery(...args);
}) as typeof pglite.query;

test('ก) listCategories แบบเดิม: ไม่คืนหมวดที่ archive (พฤติกรรมเดิมต้องไม่เปลี่ยน)', async () => {
  assert.deepEqual(
    (await listCategories(db, U1)).map((row) => row.name),
    ['อาหาร', 'เงินเดือน'],
  );
  assert.deepEqual(
    (await listCategories(db, U1, 'expense')).map((row) => row.name),
    ['อาหาร'],
  );
});

test('ข) includeArchived: true → คืนหมวดที่ archive พร้อม archivedAt', async () => {
  const rows = await listCategories(db, U1, undefined, { includeArchived: true });

  assert.deepEqual(
    rows.map((row) => row.name),
    ['ค่าห้อง', 'อาหาร', 'เงินเดือน'],
    'เรียงตาม sort_order เหมือนเดิม (ไม่สลับลำดับเพราะ includeArchived)',
  );
  const rent = rows.find((row) => row.id === C_RENT);
  assert.ok(rent?.archivedAt instanceof Date, 'ต้องมี archivedAt ให้ UI ติดป้าย "เลิกใช้แล้ว"');
  assert.ok(
    rows.every((row) => row.id !== C_U2E),
    'หมวดของผู้ใช้คนอื่นต้องไม่หลุด',
  );
});

test('ค) listCategoriesById คืนชื่อหมวดของรายการ (รวมหมวดที่ archive) เฉพาะของผู้ใช้คนนี้', async () => {
  const map = await listCategoriesById(db, U1, [C_FOOD, C_RENT, C_SALARY, C_MISSING, C_U2E]);

  assert.deepEqual([...map.keys()].sort(), [C_FOOD, C_RENT, C_SALARY].sort());
  assert.equal(map.get(C_RENT)?.name, 'ค่าห้อง', 'ชื่อของหมวดที่ archive ต้องได้ (ป้ายในรายการเก่า)');
  assert.ok(map.get(C_RENT)?.archivedAt instanceof Date);
  assert.equal(map.get(C_FOOD)?.kind, 'expense');
  assert.equal(map.has(C_U2E), false, 'หมวดของผู้ใช้คนอื่นต้องไม่หลุด');
  assert.equal(map.has(C_MISSING), false, 'id ที่ไม่มีในตาราง = ไม่มีใน map (ไม่ error)');
});

test('ง) listCategoriesById = 1 query · ids ว่าง = 0 query', async () => {
  queryCount = 0;
  const map = await listCategoriesById(db, U1, [C_FOOD, C_SALARY]);
  assert.equal(map.size, 2);
  assert.equal(queryCount, 1, 'ชื่อหมวดของทั้งหน้าต้องมาจาก query เดียว');

  queryCount = 0;
  const empty = await listCategoriesById(db, U1, []);
  assert.equal(empty.size, 0);
  assert.equal(queryCount, 0, 'ไม่มี id = ไม่ต้องยิง DB เลย');
});
