/**
 * เทสต์ write path ของงบประมาณ (budgets) บน PGlite — apply DDL จาก docs/schema.sql ตรง ๆ
 * รัน: node --test src/db/mutations/budgets.test.ts
 *
 * กติกาที่เทสต์ชุดนี้คุม:
 *   ตั้ง = แก้ (upsert ที่ unique (user_id, category_id, period_month) — schema.sql:266) ไม่มี create/update แยก
 *   ตั้งงบได้เฉพาะหมวดของผู้ใช้คนนี้ · kind='expense' · ยังไม่ archive (DB บังคับไม่ได้ ดู schema.sql:271-273)
 *   ลบงบ = DELETE จริง (ตารางไม่มี deleted_at) และลบได้เฉพาะของตัวเอง
 *   input ผิด → ValidationError ข้อความไทย (ห้ามหลุด SQL/รหัส PG ให้ผู้ใช้ — design §4)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { ValidationError } from '../errors.ts';
import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import { deleteBudget, setBudget } from './budgets.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'u1';
const U2 = 'u2';
const SESSION_1 = { userId: U1 };
const SESSION_2 = { userId: U2 };
const C = (n: number) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [C_FOOD, C_TRAVEL, C_SALARY, C_RENT, C_U2E] = [1, 2, 3, 4, 5].map(C);

const SEPT = '2026-09-01';
const OCT = '2026-10-01';

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`
  insert into "user" (id, name) values ('${U1}', 'Yoru'), ('${U2}', 'Big');
  insert into categories (id, user_id, kind, name, archived_at) values
    ('${C_FOOD}',   '${U1}', 'expense', 'อาหาร',    null),
    ('${C_TRAVEL}', '${U1}', 'expense', 'เดินทาง',  null),
    ('${C_SALARY}', '${U1}', 'income',  'เงินเดือน', null),
    ('${C_RENT}',   '${U1}', 'expense', 'ค่าห้อง',  now()),
    ('${C_U2E}',    '${U2}', 'expense', 'ของ u2',   null);
`);

const db = drizzle(pglite, { schema }) as unknown as Db;

const countBudgets = async () => {
  const result = await pglite.query<{ n: number }>('select count(*)::int as n from budgets');
  return result.rows[0].n;
};

/** ปฏิเสธด้วย ValidationError ข้อความไทย และต้องไม่มี SQL/รหัส PG หลุดถึงผู้ใช้ */
const rejectsThai = async (promise: Promise<unknown>, pattern: RegExp) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ValidationError, `ต้องเป็น ValidationError (ได้ ${String(error)})`);
    assert.match(error.message, pattern);
    assert.doesNotMatch(
      error.message,
      /select|insert|update|violates|2350|22P02/i,
      'ข้อความผู้ใช้ต้องไม่มี SQL/รหัส PG',
    );
    return true;
  });
};

test('ตั้งงบใหม่ + ตั้งซ้ำ (เดือนเดิม) = แถวเดิมถูกทับด้วยค่าใหม่ ไม่เพิ่มแถว', async () => {
  const created = await setBudget(db, SESSION_1, { categoryId: C_FOOD, periodMonth: SEPT, amount: 600_000 });
  assert.equal(created.amount, 600_000);
  assert.equal(created.categoryId, C_FOOD);
  assert.equal(created.periodMonth, SEPT);
  assert.equal(await countBudgets(), 1);

  const updated = await setBudget(db, SESSION_1, { categoryId: C_FOOD, periodMonth: SEPT, amount: 750_000 });
  assert.equal(updated.id, created.id, 'ตั้ง=แก้ ต้องได้แถวเดิม ไม่ใช่สร้างใหม่');
  assert.equal(updated.amount, 750_000, 'ค่าใหม่ต้องทับค่าเดิม');
  assert.equal(await countBudgets(), 1, 'unique (user, category, month) → ต้องไม่เพิ่มแถว');
});

test('เดือนอื่น/หมวดอื่น = คนละแถว และงบของผู้ใช้คนอื่นไม่ถูกทับ', async () => {
  await setBudget(db, SESSION_1, { categoryId: C_FOOD, periodMonth: OCT, amount: 100_000 });
  await setBudget(db, SESSION_1, { categoryId: C_TRAVEL, periodMonth: OCT, amount: 200_000 });
  await setBudget(db, SESSION_2, { categoryId: C_U2E, periodMonth: OCT, amount: 300_000 });

  const rows = await pglite.query<{ n: number }>(
    `select count(*)::int as n from budgets where period_month = '${OCT}'`,
  );
  assert.equal(rows.rows[0].n, 3, '3 งบของเดือน ต.ค. (u1 2 หมวด + u2 1 หมวด)');

  const u2 = await pglite.query<{ amount: string }>(
    `select amount from budgets where user_id = '${U2}' and period_month = '${OCT}'`,
  );
  assert.equal(Number(u2.rows[0].amount), 300_000, 'งบของ u2 ต้องไม่ถูกเขียนทับด้วยของ u1');
});

test('เพดานเงิน: amount สูงสุดที่รับได้ผ่าน · 0/-1/1e15 ถูกปฏิเสธก่อนถึง DB', async () => {
  const max = await setBudget(db, SESSION_1, {
    categoryId: C_TRAVEL,
    periodMonth: SEPT,
    amount: 999_999_999_999_999,
  });
  assert.equal(max.amount, 999_999_999_999_999);

  const before = await countBudgets();
  await rejectsThai(
    setBudget(db, SESSION_1, { categoryId: C_FOOD, periodMonth: '2026-11-01', amount: 0 }),
    /มากกว่า 0/,
  );
  await rejectsThai(
    setBudget(db, SESSION_1, { categoryId: C_FOOD, periodMonth: '2026-11-01', amount: -1 }),
    /มากกว่า 0/,
  );
  await rejectsThai(
    setBudget(db, SESSION_1, { categoryId: C_FOOD, periodMonth: '2026-11-01', amount: 1_000_000_000_000_000 }),
    /เกินเพดาน/,
  );
  await rejectsThai(
    setBudget(db, SESSION_1, { categoryId: C_FOOD, periodMonth: '2026-11-01', amount: 12.5 }),
    /สตางค์จำนวนเต็ม/,
  );
  assert.equal(await countBudgets(), before, 'input ผิดต้องไม่แตะตาราง');
});

test('งวดเดือน: วันที่ 15 / เดือน 13 / ไม่ใช่วันแรก → ปฏิเสธที่ชั้นแอป และ DB ก็กันสำรองไว้', async () => {
  await rejectsThai(
    setBudget(db, SESSION_1, { categoryId: C_FOOD, periodMonth: '2026-09-15', amount: 1000 }),
    /วันแรกของเดือน/,
  );
  await rejectsThai(
    setBudget(db, SESSION_1, { categoryId: C_FOOD, periodMonth: '2026-13-01', amount: 1000 }),
    /วันแรกของเดือน/,
  );
  await rejectsThai(
    setBudget(db, SESSION_1, { categoryId: C_FOOD, periodMonth: 'กันยายน', amount: 1000 }),
    /วันแรกของเดือน/,
  );

  // หลุดผ่านแอปไปถึง DB ต้องติด check ของ DDL เอง (schema.sql:268 budgets_period_month_ck)
  await assert.rejects(
    pglite.exec(
      `insert into budgets (user_id, category_id, period_month, amount)
       values ('${U1}', '${C_FOOD}', '2026-09-15', 1000)`,
    ),
    (error: unknown) => {
      assert.match(String((error as Error).message), /budgets_period_month_ck/);
      return true;
    },
    'DB ต้องเป็นด่านสุดท้ายของงวดเดือน',
  );
});

test('หมวด income · หมวดที่ archive · หมวดของผู้ใช้คนอื่น · categoryId ไม่ใช่ uuid → ValidationError ไม่มีแถวใหม่', async () => {
  const before = await countBudgets();

  await rejectsThai(
    setBudget(db, SESSION_1, { categoryId: C_SALARY, periodMonth: '2026-11-01', amount: 1000 }),
    /หมวดรายจ่าย/,
  );
  await rejectsThai(
    setBudget(db, SESSION_1, { categoryId: C_RENT, periodMonth: '2026-11-01', amount: 1000 }),
    /เลิกใช้แล้ว/,
  );
  await rejectsThai(
    setBudget(db, SESSION_1, { categoryId: C_U2E, periodMonth: '2026-11-01', amount: 1000 }),
    /ไม่พบหมวด/,
  );
  await rejectsThai(
    setBudget(db, SESSION_1, { categoryId: 'not-a-uuid', periodMonth: '2026-11-01', amount: 1000 }),
    /รหัสหมวด/,
  );
  await rejectsThai(setBudget(db, SESSION_1, { categoryId: C_FOOD, periodMonth: '2026-11-01' }), /จำนวนเงิน/);

  assert.equal(await countBudgets(), before, 'ทุกเคสต้องไม่สร้างแถว');
});

test('ลบงบ = แถวหายจริง · ลบของคนอื่น/ลบซ้ำ → ValidationError', async () => {
  const mine = await setBudget(db, SESSION_1, { categoryId: C_TRAVEL, periodMonth: '2026-12-01', amount: 5000 });
  const others = await setBudget(db, SESSION_2, { categoryId: C_U2E, periodMonth: '2026-12-01', amount: 6000 });

  await rejectsThai(deleteBudget(db, SESSION_1, others.id), /ไม่พบงบ/);
  await rejectsThai(deleteBudget(db, SESSION_2, mine.id), /ไม่พบงบ/);

  const remaining = await pglite.query<{ n: number }>(
    `select count(*)::int as n from budgets where period_month = '2026-12-01'`,
  );
  assert.equal(remaining.rows[0].n, 2, 'ลบข้ามผู้ใช้ต้องไม่สำเร็จ');

  assert.deepEqual(await deleteBudget(db, SESSION_1, mine.id), { id: mine.id });
  await rejectsThai(deleteBudget(db, SESSION_1, mine.id), /ไม่พบงบ/);

  const after = await pglite.query<{ id: string }>(
    `select id from budgets where period_month = '2026-12-01'`,
  );
  assert.deepEqual(
    after.rows.map((row) => row.id),
    [others.id],
    'เหลือแต่งบของ u2',
  );
});
