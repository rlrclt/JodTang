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
import {
  categoryUsage,
  listCategories,
  listCategoriesById,
  suggestedCategoryId,
  suggestedCategoryQuery,
} from './categories.ts';

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
await pglite.exec(`
  insert into accounts (id, user_id, name) values ('11111111-1111-1111-1111-111111111111', '${U1}', 'เงินสด'), ('33333333-3333-3333-3333-333333333333', '${U2}', 'ของ u2');
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
    ('${U1}', 'expense', '11111111-1111-1111-1111-111111111111', '${C_FOOD}', 1000, timestamptz '2026-09-01 10:00+07', 'ข้าว'),
    ('${U1}', 'expense', '11111111-1111-1111-1111-111111111111', '${C_FOOD}', 2000, timestamptz '2026-09-02 10:00+07', 'กาแฟ'),
    ('${U1}', 'expense', '11111111-1111-1111-1111-111111111111', '${C_RENT}', 3000, timestamptz '2026-09-03 10:00+07', 'ถูกลบแล้ว'),
    ('${U2}', 'expense', '33333333-3333-3333-3333-333333333333', '${C_U2E}', 4000, timestamptz '2026-09-04 10:00+07', 'ของ u2');
  update transactions set deleted_at = now() where note = 'ถูกลบแล้ว';
`);
await pglite.exec('vacuum analyze categories');
await pglite.exec('vacuum analyze transactions');

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

test('categoryUsage: นับรายการที่ยังไม่ถูกลบต่อหมวด · ไม่นับหมวดของผู้ใช้คนอื่น · 1 query', async () => {
  const usage = await categoryUsage(db, U1, [C_FOOD, C_RENT, C_SALARY, C_U2E]);

  assert.equal(usage.get(C_FOOD), 2, 'อาหารมี 2 แถว (แถวที่ลบแล้วไม่นับ)');
  assert.equal(usage.has(C_RENT), false, 'ไม่มีรายการที่ยังไม่ถูกลบ = ไม่มีคีย์ (ผู้เรียกอ่าน ?? 0)');
  assert.equal(usage.has(C_U2E), false, 'หมวดของผู้ใช้คนอื่นต้องไม่หลุด แม้จะส่ง id มาตรง ๆ');

  queryCount = 0;
  const empty = await categoryUsage(db, U1, []);
  assert.equal(empty.size, 0);
  assert.equal(queryCount, 0, 'ไม่มี id = ไม่ต้องยิง DB');

  queryCount = 0;
  await categoryUsage(db, U1, [C_FOOD, C_RENT]);
  assert.equal(queryCount, 1, 'ทุกหมวดต้องมาจาก query เดียว');
});

test('suggestedCategoryId: หมวดของรายการล่าสุดของ kind นั้น (ข้าม kind อื่น/ที่ลบ/ที่ archive) หรือ null', async () => {
  // fixture แยกของผู้ใช้ใหม่ — ไม่รบกวนชุดข้อมูลเดิมของไฟล์นี้
  const U3 = 'u-sug';
  const [S_FOOD, S_CAFE, S_OLD, S_SALARY] = [11, 12, 13, 14].map(C);
  const A3 = '55555555-5555-5555-5555-555555555555';
  await pglite.exec(`
    insert into "user" (id, name) values ('${U3}', 'Sug');
    insert into accounts (id, user_id, name) values ('${A3}', '${U3}', 'เงินสด');
    insert into categories (id, user_id, kind, name, archived_at) values
      ('${S_FOOD}',   '${U3}', 'expense', 'อาหาร',   null),
      ('${S_CAFE}',   '${U3}', 'expense', 'กาแฟ',    null),
      ('${S_OLD}',    '${U3}', 'expense', 'เลิกใช้', now()),
      ('${S_SALARY}', '${U3}', 'income',  'เงินเดือน', null);
    insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
      ('${U3}', 'expense', '${A3}', '${S_FOOD}',   1000, timestamptz '2026-07-01 10:00+07', 'เก่าสุด'),
      ('${U3}', 'expense', '${A3}', '${S_CAFE}',   2000, timestamptz '2026-07-02 10:00+07', 'ล่าสุดที่ยังใช้ได้'),
      ('${U3}', 'expense', '${A3}', '${S_OLD}',    3000, timestamptz '2026-07-03 10:00+07', 'หมวดถูก archive'),
      ('${U3}', 'expense', '${A3}', '${S_CAFE}',   4000, timestamptz '2026-07-04 10:00+07', 'ถูกลบแล้ว'),
      ('${U3}', 'income',  '${A3}', '${S_SALARY}', 5000, timestamptz '2026-07-05 10:00+07', 'คนละ kind');
    update transactions set deleted_at = now() where note = 'ถูกลบแล้ว';
    insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
      values ('${U2}', 'expense', '33333333-3333-3333-3333-333333333333', '${C_U2E}', 6000, timestamptz '2026-07-06 10:00+07', 'ของคนอื่น (ใหม่กว่า)');
  `);

  assert.equal(
    await suggestedCategoryId(db, U3, 'expense'),
    S_CAFE,
    'ล่าสุดที่ยังใช้ได้ = กาแฟ (ข้ามแถวที่หมวดถูก archive, แถวที่ลบแล้ว, คนละ kind และของคนอื่น)',
  );
  assert.equal(await suggestedCategoryId(db, U3, 'income'), S_SALARY, 'kind ของตัวเองก็ได้ของตัวเอง');

  // หมวดถูกลบ/archive ทั้งหมด → ข้ามไปก่อนหน้า: ตรวจด้วยผู้ใช้ที่มีแต่แถวหมวด archive
  await pglite.exec(`insert into "user" (id, name) values ('u-sug2', 'Sug2');`);
  assert.equal(await suggestedCategoryId(db, 'u-sug2', 'expense'), null, 'ไม่มีรายการเลย = null (UI หา fallback เอง)');

  queryCount = 0;
  await suggestedCategoryId(db, U3, 'expense');
  assert.equal(queryCount, 1, '1 query');

  // แผนการทำงาน: ต้องใช้ index ของ (user_id, kind, occurred_at)
  await pglite.exec('set enable_seqscan = off');
  const built = suggestedCategoryQuery(db, U3, 'expense').toSQL();
  const plan = (
    await pglite.query<{ 'QUERY PLAN': string }>(`explain (costs off) ${built.sql}`, built.params as never[])
  ).rows.map((row) => row['QUERY PLAN']).join('\n');
  await pglite.exec('set enable_seqscan = on');

  // วัดจริง: planner เลือก transactions_user_recent_idx (มี id ต่อท้ายให้ เรียงเสร็จไม่ต้อง Sort + LIMIT 1 ออกเร็ว)
  // ไม่ได้เลือก kind_time_idx เพราะ index นั้นไม่มี id → ต้อง Sort ก่อน (ต้องเพิ่ม index ไหม? ไม่ — ตัวที่มีอยู่ใช้ได้)
  assert.doesNotMatch(plan, /Seq Scan/, `ต้องไม่ตกเป็น Seq Scan:\n${plan}`);
  assert.match(
    plan,
    /transactions_user_(recent|kind_time)_idx/,
    `ต้องใช้ index ของ transactions ที่มีอยู่แล้ว (ไม่เพิ่ม index ใหม่):\n${plan}`,
  );
});
