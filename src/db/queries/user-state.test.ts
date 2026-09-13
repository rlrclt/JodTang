/**
 * เทสต์ firstRunState — "ผู้ใช้ใหม่จริงไหม" สำหรับหน้า onboarding (spec wave12 §3)
 * รัน: node --test src/db/queries/user-state.test.ts
 *
 * กติกาความหมายที่ต้องคงไว้:
 *   hasTransactions = นับเฉพาะรายการที่ยังไม่ถูกลบ (deleted_at is null) — รายการที่ลบแล้วไม่ทำให้ผู้ใช้ "ไม่ใหม่"
 *   hasAccounts/hasCategories = **นับของที่ archive แล้วด้วย** (ผู้ใช้ที่ไม่ใช่คนใหม่ แม้เลิกใช้ของเดิมไปหมด)
 *   ไม่มีคอลัมน์ธงใน DB และไม่ต้องมี migration — ตัดสินจากข้อมูลที่มีอยู่ · ทั้งหมด = 1 query
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import { firstRunState } from './user-state.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const U_NEW = 'u-new';
const U_ACC = 'u-acc';
const U_CAT = 'u-cat';
const U_TX = 'u-tx';
const U_DEL = 'u-del';
const C = (n: number) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const A = (n: number) => `20000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`
  insert into "user" (id, name) values
    ('${U_NEW}', 'ใหม่'), ('${U_ACC}', 'มีกระเป๋า'), ('${U_CAT}', 'มีหมวด'),
    ('${U_TX}', 'มีรายการ'), ('${U_DEL}', 'มีแต่ที่ลบ'), ('u-other', 'คนอื่น');

  insert into accounts (id, user_id, name) values
    ('${A(1)}', '${U_ACC}', 'เงินสด'),
    ('${A(2)}', '${U_CAT}', 'เงินสด'),
    ('${A(3)}', '${U_TX}', 'เงินสด'),
    ('${A(4)}', '${U_DEL}', 'เงินสด'),
    ('${A(5)}', 'u-other', 'เงินสด');

  insert into categories (id, user_id, kind, name, archived_at) values
    ('${C(1)}', '${U_ACC}', 'expense', 'อาหาร', null),
    ('${C(2)}', '${U_CAT}', 'expense', 'อาหาร', now()),   -- archive แล้วก็ยังนับว่า "มีหมวด"
    ('${C(3)}', '${U_TX}', 'expense', 'อาหาร', null),
    ('${C(4)}', '${U_DEL}', 'expense', 'อาหาร', null),
    ('${C(5)}', 'u-other', 'expense', 'อาหาร', null);

  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
    ('${U_TX}', 'expense', '${A(3)}', '${C(3)}', 1000, timestamptz '2026-09-01 10:00+07', 'ยังอยู่'),
    ('${U_DEL}', 'expense', '${A(4)}', '${C(4)}', 2000, timestamptz '2026-09-01 10:00+07', 'ถูกลบแล้ว'),
    ('u-other', 'expense', '${A(5)}', '${C(5)}', 3000, timestamptz '2026-09-01 10:00+07', 'ของคนอื่น');
  update transactions set deleted_at = now() where note = 'ถูกลบแล้ว';
`);

const db = drizzle(pglite, { schema }) as unknown as Db;

let queryCount = 0;
const runQuery = pglite.query.bind(pglite);
pglite.query = ((...args: Parameters<typeof runQuery>) => {
  queryCount += 1;
  return runQuery(...args);
}) as typeof pglite.query;

test('ผู้ใช้ใหม่จริง: ไม่มีกระเป๋า/หมวด/รายการ → false ทั้งสาม', async () => {
  assert.deepEqual(await firstRunState(db, U_NEW), {
    hasAccounts: false,
    hasCategories: false,
    hasTransactions: false,
  });
});

test('มีอย่างใดอย่างหนึ่ง = ไม่ใช่ผู้ใช้ใหม่ (archive แล้วก็นับ) · รายการที่ลบแล้วไม่นับ', async () => {
  assert.deepEqual(await firstRunState(db, U_ACC), {
    hasAccounts: true,
    hasCategories: true,
    hasTransactions: false,
  });
  assert.deepEqual(await firstRunState(db, U_CAT), {
    hasAccounts: true,
    hasCategories: true,
    hasTransactions: false,
  });
  assert.deepEqual(await firstRunState(db, U_TX), {
    hasAccounts: true,
    hasCategories: true,
    hasTransactions: true,
  });

  // มีแต่รายการที่ soft delete แล้ว → ยังนับเป็น "ผู้ใช้ใหม่" ในแง่รายการ
  const deleted = await firstRunState(db, U_DEL);
  assert.equal(deleted.hasTransactions, false, 'รายการที่ลบแล้วต้องไม่นับ');
  assert.equal(deleted.hasAccounts, true);
  assert.equal(deleted.hasCategories, true);
});

test('ของผู้ใช้คนอื่นไม่ทำให้ของเรากลายเป็น true · และ 1 query', async () => {
  queryCount = 0;
  const fresh = await firstRunState(db, U_NEW);
  assert.equal(queryCount, 1, 'ทั้งสามคำถามต้องมาจาก query เดียว');
  assert.deepEqual(fresh, { hasAccounts: false, hasCategories: false, hasTransactions: false });

  const other = await firstRunState(db, 'u-other');
  assert.deepEqual(other, { hasAccounts: true, hasCategories: true, hasTransactions: true });

  // id ที่ไม่มีในตาราง user เลย → false ทั้งสาม (ไม่ throw)
  assert.deepEqual(await firstRunState(db, 'u-ไม่มีจริง'), {
    hasAccounts: false,
    hasCategories: false,
    hasTransactions: false,
  });
});
