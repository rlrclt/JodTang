/**
 * เทสต์ write path กับ Postgres จริง (PGlite ในเรป) — apply DDL จาก docs/schema.sql ตรง ๆ
 * รัน: node --test src/db/mutations/transactions.test.ts
 *
 * พิสูจน์ตามเกณฑ์รับ:
 *   (1) userId มาจาก session เท่านั้น — input ที่ส่ง userId/user_id/id/deletedAt/currency ถูกปฏิเสธ
 *   (2) validate ตรงกติกา DB ก่อนยิง SQL (ละเมิดทีละข้อ → ValidationError + ตารางไม่เปลี่ยน)
 *   (3) ลบ = soft delete (หายจากยอด แต่ยังอยู่ในตาราง) · ลบซ้ำไม่ได้
 *   (5) insert แล้ว monthTotals เห็นยอดถูก · ข้ามผู้ใช้ทำไม่ได้ (composite FK ของ DB กันให้)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { addAccount } from './accounts.ts';
import { addCategory } from './categories.ts';
import { monthTotals } from '../queries/transactions.ts';
import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import {
  addTransaction,
  softDeleteTransaction,
  toUserError,
  updateTransaction,
  validateTransaction,
  ValidationError,
} from './transactions.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'u1';
const U2 = 'u2';
const SESSION_1 = { userId: U1 };
const SESSION_2 = { userId: U2 };
const A1 = '11111111-1111-1111-1111-111111111111';
const A2 = '22222222-2222-2222-2222-222222222222';
const A_U2 = '33333333-3333-3333-3333-333333333333';
const C_FOOD = '10000000-0000-0000-0000-000000000001';
const C_SALARY = '10000000-0000-0000-0000-000000000007';
const C_U2E = '10000000-0000-0000-0000-000000000009';

const SEPT = '2026-09-01';

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`
  insert into "user" (id, name) values ('${U1}', 'Yoru'), ('${U2}', 'Big');
  insert into accounts (id, user_id, name) values
    ('${A1}', '${U1}', 'เงินสด'), ('${A2}', '${U1}', 'ธนาคาร'), ('${A_U2}', '${U2}', 'ของ u2');
  insert into categories (id, user_id, kind, name) values
    ('${C_FOOD}', '${U1}', 'expense', 'อาหาร'),
    ('${C_SALARY}', '${U1}', 'income', 'เงินเดือน'),
    ('${C_U2E}', '${U2}', 'expense', 'ของ u2');
`);

// pglite กับ neon-http ใช้ query builder ตัวเดียวกัน — cast เฉพาะชนิด driver ในเทสต์
const db = drizzle(pglite, { schema }) as unknown as Db;

/**
 * ข้อความ error ทั้งชั้น: drizzle ห่อ error ของ PG ไว้ที่ cause → อ่านทั้งคู่
 * (FK ของ DB ต้อง busted ให้เห็นว่าเป็น constraint ชื่ออะไร ไม่ใช่แค่ assertion ผ่าน)
 */
const why = (error: unknown) => {
  const cause = (error as { cause?: { message?: string } }).cause;
  return `${(error as Error).message} · ${cause?.message ?? ''}`;
};

const countRows = async () => {
  const result = await pglite.query<{ n: number }>(`select count(*)::int as n from transactions`);
  return result.rows[0].n;
};

const validExpense = {
  kind: 'expense' as const,
  amount: 1284000,
  accountId: A1,
  categoryId: C_FOOD,
  occurredAt: '2026-09-10T10:00:00+07:00',
};

test('(5) insert แล้ว monthTotals เห็นยอดถูก (รับ/จ่าย/คงเหลือ)', async () => {
  const before = await monthTotals(db, U1, SEPT);

  const created = await addTransaction(db, SESSION_1, validExpense);
  assert.equal(created.amount, 1284000);
  assert.equal(created.kind, 'expense');
  assert.equal(created.deletedAt, null);
  assert.ok(created.id, 'ต้องได้ id ของแถวใหม่กลับมา');

  const after = await monthTotals(db, U1, SEPT);
  assert.deepEqual(after, {
    income: before.income,
    expense: before.expense + 1284000,
    balance: before.balance - 1284000,
  });

  await addTransaction(db, SESSION_1, {
    ...validExpense,
    kind: 'income',
    amount: 2500000,
    accountId: A2,
    categoryId: C_SALARY,
  });
  const withIncome = await monthTotals(db, U1, SEPT);
  assert.equal(withIncome.income, before.income + 2500000);
  assert.equal(withIncome.balance, withIncome.income - withIncome.expense);
});

test('(3) ลบ = soft delete: หายจากยอดแต่ยังอยู่ในตาราง · ลบซ้ำไม่ได้', async () => {
  const created = await addTransaction(db, SESSION_1, { ...validExpense, amount: 50000 });
  const withRow = await monthTotals(db, U1, SEPT);

  const deleted = await softDeleteTransaction(db, SESSION_1, created.id);
  assert.equal(deleted.id, created.id);

  // หายจากยอด
  const afterDelete = await monthTotals(db, U1, SEPT);
  assert.equal(afterDelete.expense, withRow.expense - 50000);

  // แต่ยังอยู่ในตาราง (soft delete เท่านั้น)
  const row = await pglite.query<{ deleted_at: string | null }>(
    `select deleted_at from transactions where id = '${created.id}'`,
  );
  assert.equal(row.rows.length, 1, 'แถวต้องยังอยู่ในตาราง');
  assert.notEqual(row.rows[0].deleted_at, null, 'deleted_at ต้องถูกตั้งค่า');

  // ลบซ้ำ → ไม่พบแถวที่ลบได้
  await assert.rejects(() => softDeleteTransaction(db, SESSION_1, created.id), ValidationError);
});

test('(5) ข้ามผู้ใช้ทำไม่ได้ — accountId ของคนอื่นถูก composite FK ของ DB ปฏิเสธ', async () => {
  const before = await countRows();
  await assert.rejects(
    // categoryId เป็นของ u1 เอง (ถูกต้อง) แต่กระเป๋าเป็นของ u2 → FK (account_id, user_id) ต้องปฏิเสธ
    () => addTransaction(db, SESSION_1, { ...validExpense, accountId: A_U2 }),
    (error: unknown) =>
      error instanceof ValidationError &&
      /ไม่พบกระเป๋าเงินหรือหมวด/.test(error.message) &&
      !/insert into/i.test(error.message) &&
      /transactions_account_id_user_id_fkey/.test(why(error.cause)),
  );
  assert.equal(await countRows(), before, 'ต้องไม่มีแถวใหม่ถูกสร้าง');
  await assert.rejects(
    () => addTransaction(db, SESSION_1, { ...validExpense, categoryId: C_U2E }),
    (error: unknown) =>
      error instanceof ValidationError &&
      /ไม่พบกระเป๋าเงินหรือหมวด/.test(error.message) &&
      /transactions_category_id_kind_user_id_fkey/.test(why(error.cause)),
  );
  assert.equal(await countRows(), before);
});

test('(1) userId มาจาก session เท่านั้น — input ที่ส่ง userId/id/deletedAt/currency ถูกปฏิเสธ', async () => {
  const before = await countRows();
  for (const extra of [{ userId: U2 }, { user_id: U2 }, { id: A1 }, { deletedAt: new Date() }, { currency: 'USD' }]) {
    await assert.rejects(
      () => addTransaction(db, SESSION_1, { ...validExpense, ...extra }),
      (error: unknown) => error instanceof ValidationError && /ไม่อนุญาต/.test(error.message),
      `ต้องปฏิเสธ ${JSON.stringify(extra)}`,
    );
  }
  assert.equal(await countRows(), before, 'ห้ามมีแถวถูกสร้างจาก input ที่ผิด');
  // แถวที่สร้างผ่าน session ต้องเป็นของ session เท่านั้น
  const mine = await addTransaction(db, SESSION_1, validExpense);
  const owner = await pglite.query<{ user_id: string }>(`select user_id from transactions where id = '${mine.id}'`);
  assert.equal(owner.rows[0].user_id, U1);
});

test('(2) input ผิดกติกาถูกปฏิเสธก่อนถึง DB (ละเมิดทีละข้อ)', async () => {
  const before = await countRows();
  const cases: { patch: Record<string, unknown>; expect: RegExp; why: string }[] = [
    { patch: { amount: 0 }, expect: /มากกว่า 0/, why: 'amount = 0' },
    { patch: { amount: -100 }, expect: /มากกว่า 0/, why: 'amount ติดลบ' },
    { patch: { amount: 100.5 }, expect: /จำนวนเต็มหน่วยสตางค์/, why: 'amount ไม่ใช่จำนวนเต็ม' },
    { patch: { amount: '100' }, expect: /ต้องเป็นตัวเลข/, why: 'amount เป็นสตริง' },
    { patch: { amount: 1_000_000_000_000_000 }, expect: /เพดาน/, why: 'amount เกินเพดาน 1e15' },
    { patch: { kind: 'refund' }, expect: /ประเภทรายการไม่ถูกต้อง/, why: 'kind ไม่รู้จัก' },
    { patch: { kind: undefined }, expect: /ประเภทรายการไม่ถูกต้อง/, why: 'ไม่มี kind' },
    { patch: { kind: 'transfer', toAccountId: null, categoryId: null }, expect: /ปลายทาง/, why: 'transfer ไม่มีปลายทาง' },
    { patch: { kind: 'transfer', toAccountId: A1, categoryId: null }, expect: /เดียวกัน/, why: 'transfer เข้ากระเป๋าเดียวกัน' },
    { patch: { kind: 'transfer', toAccountId: A2, categoryId: C_FOOD }, expect: /ไม่มีหมวด/, why: 'transfer มีหมวด' },
    { patch: { kind: 'expense', toAccountId: A2, categoryId: C_FOOD }, expect: /ไม่มีกระเป๋าปลายทาง/, why: 'expense มีปลายทาง' },
    { patch: { kind: 'income', toAccountId: null, categoryId: null }, expect: /ต้องระบุหมวด/, why: 'income ไม่มีหมวด' },
    { patch: { categoryId: null, kind: 'expense', toAccountId: null }, expect: /ต้องระบุหมวด/, why: 'expense ไม่มีหมวด' },
    { patch: { accountId: '' }, expect: /กระเป๋าเงิน/, why: 'accountId ว่าง' },
    { patch: { note: 42 }, expect: /โน้ต/, why: 'note ไม่ใช่ข้อความ' },
    { patch: { occurredAt: 'ไม่ใช่วันที่' }, expect: /วันที่/, why: 'วันที่ผิด' },
  ];
  for (const { patch, expect, why } of cases) {
    await assert.rejects(
      () => addTransaction(db, SESSION_1, { ...validExpense, ...patch }),
      (error: unknown) => error instanceof ValidationError && expect.test(error.message),
      `ต้องปฏิเสธ: ${why}`,
    );
  }
  assert.equal(await countRows(), before, 'ทั้ง 16 เคสต้องไม่แตะ DB เลย');
  // input ที่ไม่ใช่ object ก็ต้องปฏิเสธ
  for (const bad of [null, 'x', 42, [validExpense]]) {
    await assert.rejects(() => addTransaction(db, SESSION_1, bad), ValidationError);
  }
  // ชั้น validate ล้วน ๆ ต้องโยนแบบ sync ด้วย (ใช้ซ้ำได้ก่อนแตะ DB)
  assert.throws(() => validateTransaction({ ...validExpense, amount: -1 }), ValidationError);
});

test('(2) แก้รายการ: ประกอบร่างใหม่แล้วตรวจกติกาชุดเดิม · เปลี่ยน kind ไม่ได้ · แก้ของที่ลบแล้วไม่ได้', async () => {
  const created = await addTransaction(db, SESSION_1, { ...validExpense, amount: 10000 });
  const beforeEdit = await monthTotals(db, U1, SEPT);

  const updated = await updateTransaction(db, SESSION_1, created.id, { amount: 25000, note: 'แก้ยอด' });
  assert.equal(updated.amount, 25000);
  const noteRow = await pglite.query<{ note: string | null }>(
    `select note from transactions where id = '${created.id}'`,
  );
  assert.equal(noteRow.rows[0].note, 'แก้ยอด', 'โน้ตที่แก้ต้องถูกเขียนลง DB');
  const afterEdit = await monthTotals(db, U1, SEPT);
  assert.equal(afterEdit.expense, beforeEdit.expense + 15000, 'ยอดเดือนต้องขยับตามส่วนต่างที่แก้');

  // แก้ให้รูปร่างพัง → ปฏิเสธ และค่าใน DB ต้องไม่เปลี่ยน
  await assert.rejects(
    () => updateTransaction(db, SESSION_1, created.id, { categoryId: null }),
    (error: unknown) => error instanceof ValidationError && /ต้องระบุหมวด/.test(error.message),
  );
  const stillThere = await pglite.query<{ category_id: string; amount: string | number }>(
    `select category_id, amount from transactions where id = '${created.id}'`,
  );
  assert.equal(stillThere.rows[0].category_id, C_FOOD);
  assert.equal(Number(stillThere.rows[0].amount), 25000);

  await assert.rejects(
    () => updateTransaction(db, SESSION_1, created.id, { kind: 'transfer', toAccountId: A2 }),
    (error: unknown) => error instanceof ValidationError && /เปลี่ยนประเภท/.test(error.message),
  );
  await assert.rejects(
    () => updateTransaction(db, SESSION_1, created.id, { userId: U2 }),
    ValidationError,
  );

  // แก้ของ u2 (มีจริงในระบบ) ด้วย session ของ u1 → ไม่พบ
  const u2row = await addTransaction(db, SESSION_2, {
    kind: 'expense',
    amount: 7000,
    accountId: A_U2,
    categoryId: C_U2E,
  });
  await assert.rejects(
    () => updateTransaction(db, SESSION_1, u2row.id, { amount: 999 }),
    (error: unknown) => error instanceof ValidationError && /ไม่พบรายการ/.test(error.message),
  );
  await assert.rejects(
    () => softDeleteTransaction(db, SESSION_1, u2row.id),
    (error: unknown) => error instanceof ValidationError && /ไม่พบรายการ/.test(error.message),
  );
  const untouched = await pglite.query<{ amount: string | number; deleted_at: string | null }>(
    `select amount, deleted_at from transactions where id = '${u2row.id}'`,
  );
  assert.equal(Number(untouched.rows[0].amount), 7000, 'ของ u2 ต้องไม่ถูกแก้');
  assert.equal(untouched.rows[0].deleted_at, null, 'ของ u2 ต้องไม่ถูกลบ');

  // ลบแล้วแก้ไม่ได้
  await softDeleteTransaction(db, SESSION_1, created.id);
  await assert.rejects(() => updateTransaction(db, SESSION_1, created.id, { amount: 30000 }), ValidationError);
});

test('(B) DB ปฏิเสธ → ValidationError ข้อความไทย ไม่มี SQL หลุด (ฝั่ง add และ update)', async () => {
  const leaks = /insert into|update "transactions"|select |violates|constraint/i;
  const expectUserError = (message: RegExp, constraint?: RegExp) => (error: unknown) => {
    if (!(error instanceof ValidationError)) return false;
    if (leaks.test(error.message)) return false; // SQL/ศัพท์เทคนิคต้องไม่ถึงผู้ใช้
    if (!message.test(error.message)) return false;
    // แต่ยังต้องพิสูจน์ได้ว่า DB เป็นคนกันจริง (รายละเอียดอยู่ใน cause ไม่ใช่ในข้อความผู้ใช้)
    return constraint ? constraint.test(why(error.cause)) : true;
  };

  const row = await addTransaction(db, SESSION_1, { ...validExpense, amount: 12000 });

  // 22P02 — uuid ผิดรูป (ฝั่ง add)
  await assert.rejects(
    () => addTransaction(db, SESSION_1, { ...validExpense, accountId: 'not-a-uuid' }),
    expectUserError(/รูปแบบข้อมูลไม่ถูกต้อง/),
  );
  // 22P02 — id ผิดรูป (ฝั่ง update)
  await assert.rejects(
    () => updateTransaction(db, SESSION_1, 'not-a-uuid', { amount: 999 }),
    expectUserError(/รูปแบบข้อมูลไม่ถูกต้อง/),
  );
  // 23503 — กระเป๋าของผู้ใช้คนอื่น (ฝั่ง update)
  await assert.rejects(
    () => updateTransaction(db, SESSION_1, row.id, { accountId: A_U2 }),
    expectUserError(/ไม่พบกระเป๋าเงินหรือหมวด/, /transactions_account_id_user_id_fkey/),
  );
  // 23503 — กระเป๋าไม่มีอยู่จริง (uuid ถูกรูปแบบ)
  await assert.rejects(
    () => updateTransaction(db, SESSION_1, row.id, { accountId: '99999999-9999-9999-9999-999999999999' }),
    expectUserError(/ไม่พบกระเป๋าเงินหรือหมวด/, /transactions_account_id_user_id_fkey/),
  );
  // 23503 — หมวด kind ไม่ตรง (รายจ่ายไปผูกหมวดรายรับ)
  await assert.rejects(
    () => updateTransaction(db, SESSION_1, row.id, { categoryId: C_SALARY }),
    expectUserError(/ไม่พบกระเป๋าเงินหรือหมวด/, /transactions_category_id_kind_user_id_fkey/),
  );

  // เคสที่ล้มต้องไม่ทิ้งร่องรอย: ค่าใน DB ยังเป็นชุดเดิม
  const after = await pglite.query<{ account_id: string; category_id: string; amount: string | number }>(
    `select account_id, category_id, amount from transactions where id = '${row.id}'`,
  );
  assert.deepEqual(
    { ...after.rows[0], amount: Number(after.rows[0].amount) },
    { account_id: A1, category_id: C_FOOD, amount: 12000 },
  );

  // 23514 (check ของ DB): validate กันก่อนถึง DB ทุกเส้นทาง จึงพิสูจน์การแปลตรง ๆ ที่ฟังก์ชัน
  assert.ok(toUserError({ code: '23514' }) instanceof ValidationError);
  assert.ok(toUserError({ code: '22P02' }) instanceof ValidationError);
  // รหัสที่ไม่รู้จักต้องไม่ถูกกลืน (บั๊กจริง/DB ล่ม ต้องเห็น error เดิม)
  const unknown = new Error('connection reset');
  assert.equal(toUserError(unknown), unknown);
});

test('(A) แพ้การแข่งตอน update: แถวถูกลบระหว่าง select กับ update → ValidationError ไม่ใช่ undefined', async () => {
  const row = await addTransaction(db, SESSION_1, { ...validExpense, amount: 33000 });

  // intercept ที่ client ของ drizzle: หลัง SELECT สำเร็จ (ก่อน SQL ของ update จะถูกส่ง) ให้ลบแถวนั้นทิ้ง
  // (จำลองเปิดสองแท็บ: แท็บหนึ่งลบก่อน อีกแท็บกดบันทึก — ต้อง deterministic ไม่ใช่การเดา)
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
              `update transactions set deleted_at = now() where id = '${row.id}'`,
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
    () => updateTransaction(racing, SESSION_1, row.id, { amount: 44000 }),
    (error: unknown) => error instanceof ValidationError && /ไม่พบรายการนี้/.test(error.message),
    'ต้องได้ ValidationError (เดิมคืน undefined แล้วไปพังเป็น TypeError = 500)',
  );

  // ข้อมูลไม่เสียหาย: แถวยังอยู่ (ลบ) และยอดเดิม
  const state = await pglite.query<{ amount: string | number; deleted_at: string | null }>(
    `select amount, deleted_at from transactions where id = '${row.id}'`,
  );
  assert.equal(Number(state.rows[0].amount), 33000);
  assert.notEqual(state.rows[0].deleted_at, null);
});

test('(C) patch occurredAt: null/\'\' = คงค่าเดิม (คนละความหมายกับ add ที่ไม่ส่ง = now())', async () => {
  const created = await addTransaction(db, SESSION_1, {
    ...validExpense,
    amount: 15000,
    occurredAt: '2026-09-20T09:00:00+07:00',
  });

  for (const occurredAt of [null, '']) {
    const patched = await updateTransaction(db, SESSION_1, created.id, { amount: 16000, occurredAt });
    assert.equal(
      patched.occurredAt?.toISOString(),
      created.occurredAt?.toISOString(),
      `patch occurredAt=${String(occurredAt)} ต้องคงค่าเดิม ไม่ใช่ล้าง`,
    );
  }

  // add ที่ไม่ส่ง occurredAt = DB ใส่ now() (ไม่ใช่คงเดิม)
  const fresh = await addTransaction(db, SESSION_1, { ...validExpense, amount: 17000, occurredAt: undefined });
  assert.ok(
    Math.abs(Date.now() - (fresh.occurredAt?.getTime() ?? 0)) < 120_000,
    'add ที่ไม่ส่ง occurredAt ต้องได้เวลาปัจจุบันจาก DB',
  );
});

test('โน้ตยาวเกิน 500 ตัวอักษรถูกปฏิเสธ (ไม่ตัดข้อมูลผู้ใช้เงียบ ๆ) — audit F4', async () => {
  const account = await addAccount(db, SESSION_1, { name: 'กระเป๋าสำหรับเทสต์โน้ต', kind: 'cash' });
  const category = await addCategory(db, SESSION_1, { kind: 'expense', name: 'หมวดสำหรับเทสต์โน้ต' });
  const base = { kind: 'expense' as const, amount: 1000, accountId: account.id, categoryId: category.id };

  const okLength = await addTransaction(db, SESSION_1, { ...base, note: 'ก'.repeat(500) });
  // อ่านความยาวจริงจาก DB (TxnRow ไม่ได้ select note มา — ต้องยืนยันว่าของที่เก็บได้ 500 ตัวจริง)
  const stored = await pglite.query<{ len: number }>(
    `select length(note)::int as len from transactions where id = '${okLength.id}'`,
  );
  assert.equal(stored.rows[0].len, 500, '500 ตัวอักษรต้องผ่านและถูกเก็บครบ (ขอบบนพอดี)');

  await assert.rejects(
    () => addTransaction(db, SESSION_1, { ...base, note: 'ก'.repeat(501) }),
    (error: unknown) => error instanceof ValidationError && /โน้ตยาวเกิน 500/.test(error.message),
  );
});
