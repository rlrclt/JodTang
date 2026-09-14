/**
 * เทสต์ write path ของหมวด (categories) บน PGlite — apply DDL จาก docs/schema.sql ตรง ๆ
 * รัน: node --test src/db/mutations/categories.test.ts
 *
 * กติกาที่ต่างจาก transactions และถูกคุมด้วยเทสต์ชุดนี้:
 *   active = archived_at is null (ไม่ใช่ deleted_at) · ชื่อซ้ำเฉพาะใน kind เดียวกัน (unique partial + lower(btrim)) = 23505
 *   kind ของหมวดเปลี่ยนไม่ได้ (transactions อ้าง (category_id, kind, user_id)) · archive แทนลบเสมอ
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { ValidationError } from '../errors.ts';
import type { Db } from '../index.ts';
import { listCategories } from '../queries/categories.ts';
import { monthTotals } from '../queries/transactions.ts';
import * as schema from '../schema.ts';
import { addAccount } from './accounts.ts';
import {
  addCategory,
  archiveCategory,
  restoreCategory,
  updateCategory,
  validateCategory,
} from './categories.ts';
import { addTransaction } from './transactions.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'u1';
const U2 = 'u2';
const SESSION_1 = { userId: U1 };
const SESSION_2 = { userId: U2 };

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`insert into "user" (id, name) values ('${U1}', 'Yoru'), ('${U2}', 'Big');`);

const db = drizzle(pglite, { schema }) as unknown as Db;

const why = (error: unknown) => {
  const parts: string[] = [];
  for (let node: unknown = error, depth = 0; node && depth < 5; depth++) {
    parts.push(String((node as { message?: unknown }).message ?? ''));
    node = (node as { cause?: unknown }).cause;
  }
  return parts.join(' · ');
};

const countRows = async (table: string) => {
  const result = await pglite.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return result.rows[0].n;
};

const rawCategory = async (id: string) => {
  const result = await pglite.query<{ kind: string; name: string; archived_at: string | null; sort_order: number }>(
    `select kind, name, archived_at, sort_order from categories where id = '${id}'`,
  );
  return result.rows[0];
};

test('สร้าง/แก้ชื่อ/เรียงลำดับ/archive สำเร็จ · ลิสต์เรียงตาม sort_order', async () => {
  const food = await addCategory(db, SESSION_1, { kind: 'expense', name: '  อาหาร  ', sortOrder: 2 });
  assert.equal(food.name, 'อาหาร', 'ช่องว่างหัวท้ายถูกตัดตอนเก็บ');
  assert.equal(food.kind, 'expense');
  assert.equal(food.sortOrder, 2);

  const travel = await addCategory(db, SESSION_1, { kind: 'expense', name: 'เดินทาง', sortOrder: 1 });
  const salary = await addCategory(db, SESSION_1, { kind: 'income', name: 'เงินเดือน' });
  assert.equal(salary.sortOrder, 0, 'ไม่ส่ง sortOrder = 0 ตาม default ของ DB');

  assert.deepEqual((await listCategories(db, U1, 'expense')).map((row) => row.name), ['เดินทาง', 'อาหาร']);
  assert.deepEqual((await listCategories(db, U1, 'income')).map((row) => row.name), ['เงินเดือน']);
  assert.equal((await listCategories(db, U1)).length, 3);

  // แก้ชื่อ + ลำดับ
  const renamed = await updateCategory(db, SESSION_1, travel.id, { name: 'เดินทาง-รถเมล์', sortOrder: 0 });
  assert.equal(renamed.name, 'เดินทาง-รถเมล์');
  assert.deepEqual((await listCategories(db, U1, 'expense')).map((row) => row.name), ['เดินทาง-รถเมล์', 'อาหาร']);

  // archive → หายจากลิสต์ แต่ยังอยู่ในตาราง
  await archiveCategory(db, SESSION_1, food.id);
  assert.deepEqual((await listCategories(db, U1, 'expense')).map((row) => row.name), ['เดินทาง-รถเมล์']);
  assert.notEqual((await rawCategory(food.id)).archived_at, null);
  assert.equal(await countRows('categories'), 3, 'archive ห้ามลบแถว');
  await assert.rejects(
    () => archiveCategory(db, SESSION_1, food.id),
    (error: unknown) => error instanceof ValidationError && /ไม่พบหมวดนี้/.test(error.message),
  );
});

test('ชื่อซ้ำใน kind เดียวกัน (พิมพ์ใหญ่/ช่องว่างหัวท้าย) โดน 23505 → ข้อความไทยไม่มี SQL', async () => {
  const before = await countRows('categories');
  await addCategory(db, SESSION_1, { kind: 'expense', name: 'Food' });

  const duplicates = [
    { kind: 'expense', name: 'Food' },
    { kind: 'expense', name: 'FOOD' },
    { kind: 'expense', name: '  food  ' },
  ];
  for (const input of duplicates) {
    await assert.rejects(
      () => addCategory(db, SESSION_1, input),
      (error: unknown) =>
        error instanceof ValidationError &&
        error.message === 'มีชื่อนี้อยู่แล้ว' && // ข้อความไทยล้วน ไม่มี SQL
        /categories_user_kind_name_uidx/.test(why(error)),
      `ต้องโดน unique: ${input.name}`,
    );
  }
  assert.equal(await countRows('categories'), before + 1);

  // ชื่อเดียวกันแต่คนละทิศทาง = ไม่ซ้ำ (unique มี kind อยู่ด้วย)
  const incomeFood = await addCategory(db, SESSION_1, { kind: 'income', name: 'FOOD' });
  assert.equal(incomeFood.kind, 'income');
  // ชื่อเดิมของ u2 ไม่ชนกับ u1
  await addCategory(db, SESSION_2, { kind: 'expense', name: 'Food' });

  // archive แล้วใช้ชื่อซ้ำได้อีก (partial unique: where archived_at is null)
  const mine = (await listCategories(db, U1, 'expense')).find((row) => row.name === 'Food');
  assert.ok(mine);
  await archiveCategory(db, SESSION_1, mine.id);
  assert.equal((await addCategory(db, SESSION_1, { kind: 'expense', name: 'Food' })).name, 'Food');
});

test('kind/ฟิลด์ต้องห้าม/การเปลี่ยนประเภท ถูกปฏิเสธก่อนถึง DB', async () => {
  const before = await countRows('categories');
  const bad: { input: Record<string, unknown>; expect: RegExp; why: string }[] = [
    { input: { kind: 'transfer', name: 'โอน' }, expect: /kind ต้องเป็น/, why: 'kind นอกลิสต์ของ DB' },
    { input: { name: 'ไม่มี kind' }, expect: /kind ต้องเป็น/, why: 'ไม่ส่ง kind' },
    { input: { kind: 'expense', name: '   ' }, expect: /ชื่อหมวด/, why: 'ชื่อมีแต่ช่องว่าง' },
    { input: { kind: 'expense', name: 'x', sortOrder: 1.5 }, expect: /จำนวนเต็ม/, why: 'sortOrder ทศนิยม' },
    { input: { kind: 'expense', name: 'x', sortOrder: '1' }, expect: /จำนวนเต็ม/, why: 'sortOrder เป็นสตริง' },
    { input: { kind: 'expense', name: 'x', userId: U2 }, expect: /ไม่อนุญาต/, why: 'userId จาก input' },
    { input: { kind: 'expense', name: 'x', archivedAt: new Date() }, expect: /ไม่อนุญาต/, why: 'archivedAt จาก input' },
  ];
  for (const { input, expect, why: label } of bad) {
    await assert.rejects(
      () => addCategory(db, SESSION_1, input),
      (error: unknown) => error instanceof ValidationError && expect.test(error.message),
      `ต้องปฏิเสธ: ${label}`,
    );
  }
  assert.equal(await countRows('categories'), before);
  for (const notObject of [null, 'x', 42, []]) {
    await assert.rejects(() => addCategory(db, SESSION_1, notObject), ValidationError);
  }
  assert.throws(() => validateCategory({ kind: 'expense', name: '' }), ValidationError);

  // เปลี่ยน kind ไม่ได้ (รายการเก่าอ้าง kind ผ่าน composite FK)
  const cat = await addCategory(db, SESSION_1, { kind: 'expense', name: 'ของเปลี่ยนประเภท' });
  await assert.rejects(
    () => updateCategory(db, SESSION_1, cat.id, { kind: 'income' }),
    (error: unknown) => error instanceof ValidationError && /เปลี่ยนประเภทหมวด/.test(error.message),
  );
  assert.equal((await rawCategory(cat.id)).kind, 'expense');
});

test('archive หมวดแล้ว: รายการเก่ายังอ้างได้และยังนับในยอด · แก้ของที่ archive แล้วไม่ได้', async () => {
  const account = await addAccount(db, SESSION_1, { name: 'เงินสด cat-test', kind: 'cash' });
  const cat = await addCategory(db, SESSION_1, { kind: 'expense', name: 'หมวดที่จะเก็บ' });

  await addTransaction(db, SESSION_1, {
    kind: 'expense',
    amount: 45000,
    accountId: account.id,
    categoryId: cat.id,
    occurredAt: '2026-09-07T10:00:00+07:00',
  });

  await archiveCategory(db, SESSION_1, cat.id);
  assert.equal((await listCategories(db, U1, 'expense')).some((row) => row.id === cat.id), false);
  assert.equal(await countRows('transactions'), 1, 'แถวรายการต้องไม่หายไปกับหมวดที่ archive');
  assert.ok((await monthTotals(db, U1, '2026-09-01')).expense >= 45000, 'รายการเก่ายังถูกนับ');

  await assert.rejects(
    () => updateCategory(db, SESSION_1, cat.id, { name: 'ปลุกคืน' }),
    (error: unknown) => error instanceof ValidationError && /ไม่พบหมวดนี้/.test(error.message),
  );
});

test('ข้ามผู้ใช้: เห็น/แก้/archive ของคนอื่นไม่ได้ · หมวดต้องเป็นของผู้ใช้และ kind ต้องตรง', async () => {
  const theirs = await addCategory(db, SESSION_2, { kind: 'expense', name: 'หมวดของเขา' });

  const mineList = await listCategories(db, U1);
  const theirsList = await listCategories(db, U2);
  assert.ok(theirsList.some((row) => row.id === theirs.id), 'u2 ต้องเห็นของตัวเอง');
  assert.equal(mineList.some((row) => row.id === theirs.id), false, 'u1 ต้องไม่เห็นของ u2');
  const mineIds = new Set(mineList.map((row) => row.id));
  assert.equal(theirsList.some((row) => mineIds.has(row.id)), false, 'u2 ต้องไม่เห็นของ u1');

  for (const attempt of [
    () => updateCategory(db, SESSION_1, theirs.id, { name: 'แก้ของเขา' }),
    () => archiveCategory(db, SESSION_1, theirs.id),
  ]) {
    await assert.rejects(
      attempt,
      (error: unknown) => error instanceof ValidationError && /ไม่พบหมวดนี้/.test(error.message),
    );
  }
  const untouched = await rawCategory(theirs.id);
  assert.equal(untouched.name, 'หมวดของเขา');
  assert.equal(untouched.archived_at, null);

  const account = await addAccount(db, SESSION_1, { name: 'เงินสด cross-test', kind: 'cash' });
  // หมวดของผู้ใช้คนอื่น → composite FK (category_id, kind, user_id) ปฏิเสธ
  await assert.rejects(
    () =>
      addTransaction(db, SESSION_1, {
        kind: 'expense',
        amount: 999,
        accountId: account.id,
        categoryId: theirs.id,
      }),
    (error: unknown) =>
      error instanceof ValidationError &&
      error.message === 'ไม่พบกระเป๋าเงินหรือหมวดที่อ้างถึง (หรือไม่ใช่ของผู้ใช้คนนี้)' &&
      /transactions_category_id_kind_user_id_fkey/.test(why(error)),
  );

  // kind ของหมวดไม่ตรงกับ kind ของรายการ → FK ตัวเดียวกันปฏิเสธ (หมวดรับของ "เขา" หรือของเราเองก็ตาม)
  const myIncome = await addCategory(db, SESSION_1, { kind: 'income', name: 'รับของฉัน' });
  await assert.rejects(
    () =>
      addTransaction(db, SESSION_1, {
        kind: 'expense',
        amount: 999,
        accountId: account.id,
        categoryId: myIncome.id,
      }),
    (error: unknown) => error instanceof ValidationError && /ไม่พบกระเป๋าเงินหรือหมวด/.test(error.message),
  );
  // แต่หมวดรายรับกับรายการรายรับ = ผ่าน
  const ok = await addTransaction(db, SESSION_1, {
    kind: 'income',
    amount: 5000,
    accountId: account.id,
    categoryId: myIncome.id,
    occurredAt: '2026-09-08T10:00:00+07:00',
  });
  assert.equal(ok.amount, 5000);
  assert.equal(ok.kind, 'income');
});

test('แพ้การแข่งตอน update: แถวถูก archive ระหว่าง select กับ update → ValidationError ไม่ใช่ undefined', async () => {
  const row = await addCategory(db, SESSION_1, { kind: 'expense', name: 'หมวดแข่ง', sortOrder: 3 });

  // intercept ที่ client ของ drizzle: หลัง SELECT สำเร็จ → archive แถวนั้นก่อนที่ SQL ของ update จะถูกส่ง
  let raced = false;
  const racingClient = new Proxy(pglite as unknown as Record<string, unknown>, {
    get(target, prop) {
      if (prop === 'query') {
        return async (...args: unknown[]) => {
          const result = await (Reflect.get(target, 'query') as (...a: unknown[]) => Promise<unknown>).apply(
            target,
            args,
          );
          if (!raced && /select/i.test(String(args[0]))) {
            raced = true;
            await (Reflect.get(target, 'exec') as (sql: string) => Promise<unknown>).call(
              target,
              `update categories set archived_at = now() where id = '${row.id}'`,
            );
          }
          return result;
        };
      }
      return Reflect.get(target, prop);
    },
  }) as unknown as typeof pglite;
  const racing = drizzle(racingClient, { schema }) as unknown as Db;

  await assert.rejects(
    () => updateCategory(racing, SESSION_1, row.id, { name: 'แก้ไม่ทัน' }),
    (error: unknown) => error instanceof ValidationError && /ไม่พบหมวดนี้/.test(error.message),
    'ต้องได้ ValidationError (ถ้าไม่มี guard จะเป็น TypeError จาก undefined)',
  );

  const after = await rawCategory(row.id);
  assert.equal(after.name, 'หมวดแข่ง', 'ชื่อต้องไม่ถูกเขียนทับ');
  assert.equal(after.sort_order, 3);
  assert.notEqual(after.archived_at, null, 'แถวต้องยังถูก archive อยู่');
});

test('กู้คืนหมวด (restore): กลับมาในลิสต์ปกติ · ข้ามผู้ใช้ทำไม่ได้ · ชื่อชนของที่สร้างใหม่ระหว่าง archive = ข้อความไทย', async () => {
  const gone = await addCategory(db, SESSION_1, { kind: 'expense', name: 'ของที่เลิกใช้' });
  await archiveCategory(db, SESSION_1, gone.id);
  assert.equal(
    (await listCategories(db, U1)).some((row) => row.id === gone.id),
    false,
    'archive แล้วต้องไม่อยู่ในลิสต์ปกติ',
  );

  // ข้ามผู้ใช้ทำไม่ได้
  await assert.rejects(
    () => restoreCategory(db, SESSION_2, gone.id),
    (error: unknown) => error instanceof ValidationError && /ไม่พบหมวดนี้/.test(error.message),
  );
  assert.notEqual((await rawCategory(gone.id)).archived_at, null, 'ของ u2 ต้องไม่ถูกปลด archive');

  // ยกเลิกซ้ำบนแถวที่ยัง active = ไม่ใช่ no-op เงียบ ๆ
  const active = await addCategory(db, SESSION_1, { kind: 'expense', name: 'ยังใช้อยู่' });
  await assert.rejects(() => restoreCategory(db, SESSION_1, active.id), ValidationError);

  assert.deepEqual(await restoreCategory(db, SESSION_1, gone.id), { id: gone.id });
  assert.equal((await rawCategory(gone.id)).archived_at, null);
  assert.equal(
    (await listCategories(db, U1)).some((row) => row.id === gone.id),
    true,
    'ยกเลิก archive แล้วต้องกลับมาในลิสต์ปกติ',
  );
});

test('กู้คืนแล้วชนชื่อหมวดที่สร้างใหม่ระหว่างนั้น → 23505 ออกเป็นข้อความไทย (ไม่ใช่ error ดิบ)', async () => {
  const first = await addCategory(db, SESSION_1, { kind: 'expense', name: 'ชื่อชน' });
  await archiveCategory(db, SESSION_1, first.id);
  // สร้างชื่อเดิมได้หลัง archive (partial unique index) — นี่คือกับดักที่ schema review เตือนไว้
  const second = await addCategory(db, SESSION_1, { kind: 'expense', name: 'ชื่อชน' });
  assert.notEqual(second.id, first.id);

  await assert.rejects(
    () => restoreCategory(db, SESSION_1, first.id),
    (error: unknown) => error instanceof ValidationError && /มีชื่อนี้อยู่แล้ว/.test(error.message),
  );
  assert.notEqual((await rawCategory(first.id)).archived_at, null, 'ไม่สำเร็จ = ต้องยัง archive อยู่');
  assert.equal((await rawCategory(second.id)).archived_at, null, 'แถวที่ active ต้องไม่ถูกแตะ');
});

test('ชื่อหมวดยาวเกิน 100 ตัวอักษรถูกปฏิเสธ (audit F4)', async () => {
  const ok = await addCategory(db, SESSION_1, { kind: 'expense', name: 'ข'.repeat(100) });
  assert.equal(ok.name.length, 100, '100 ตัวอักษรต้องผ่าน (ขอบบนพอดี)');

  await assert.rejects(
    () => addCategory(db, SESSION_1, { kind: 'expense', name: 'ข'.repeat(101) }),
    (error: unknown) => error instanceof ValidationError && /ชื่อหมวดยาวเกิน 100/.test(error.message),
  );
});
