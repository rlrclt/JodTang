/**
 * เทสต์ write path ของกระเป๋าเงิน (accounts) บน PGlite — apply DDL จาก docs/schema.sql ตรง ๆ
 * รัน: node --test src/db/mutations/accounts.test.ts
 *
 * กติกาที่ต่างจาก transactions และถูกคุมด้วยเทสต์ชุดนี้:
 *   active = archived_at is null (ไม่ใช่ deleted_at) · ชื่อซ้ำไม่สนพิมพ์ใหญ่-เล็ก/ช่องว่างหัวท้าย = 23505
 *   initial_balance ติดลบได้ (บัตรเครดิต) แต่ต้องอยู่ในช่วง ±1e15 · archive แทนลบเสมอ
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { Db } from '../index.ts';
import { listAccounts } from '../queries/accounts.ts';
import * as schema from '../schema.ts';
import { monthTotals } from '../queries/transactions.ts';
import { ValidationError } from '../errors.ts';
import { addTransaction } from './transactions.ts';
import { addAccount, archiveAccount, updateAccount, validateAccount } from './accounts.ts';

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

const rawAccount = async (id: string) => {
  const result = await pglite.query<{ name: string; kind: string; initial_balance: string | number; archived_at: string | null }>(
    `select name, kind, initial_balance, archived_at from accounts where id = '${id}'`,
  );
  return result.rows[0];
};

test('สร้าง/เปลี่ยนชื่อ/archive สำเร็จ · ลิสต์ active เห็นเฉพาะที่ยังใช้งาน', async () => {
  const cash = await addAccount(db, SESSION_1, { name: 'เงินสด', kind: 'cash', initialBalance: 0 });
  assert.equal(cash.name, 'เงินสด');
  assert.equal(cash.kind, 'cash');
  assert.equal(cash.archivedAt, null);

  // ช่องว่างหัวท้ายถูกตัดตอนเก็บ (DB บังคับ btrim(name) <> '')
  const bank = await addAccount(db, SESSION_1, { name: '  ธนาคาร  ', kind: 'bank', initialBalance: 250000 });
  assert.equal(bank.name, 'ธนาคาร');
  assert.equal(bank.initialBalance, 250000);

  assert.deepEqual((await listAccounts(db, U1)).map((row) => row.name).sort(), ['ธนาคาร', 'เงินสด']);

  // เปลี่ยนชื่อ (patch) → ลิสต์สะท้อนค่าใหม่
  const renamed = await updateAccount(db, SESSION_1, bank.id, { name: 'ธนาคารกสิกร' });
  assert.equal(renamed.name, 'ธนาคารกสิกร');
  assert.deepEqual((await listAccounts(db, U1)).map((row) => row.name).sort(), ['ธนาคารกสิกร', 'เงินสด']);

  // archive → หายจากลิสต์ active แต่ยังอยู่ในตาราง
  await archiveAccount(db, SESSION_1, cash.id);
  assert.deepEqual((await listAccounts(db, U1)).map((row) => row.name), ['ธนาคารกสิกร']);
  assert.notEqual((await rawAccount(cash.id)).archived_at, null);
  assert.equal(await countRows('accounts'), 2, 'archive ห้ามลบแถว');

  // archive ซ้ำ → ValidationError
  await assert.rejects(
    () => archiveAccount(db, SESSION_1, cash.id),
    (error: unknown) => error instanceof ValidationError && /ไม่พบกระเป๋านี้/.test(error.message),
  );
});

test('ชื่อซ้ำ (พิมพ์ใหญ่/ช่องว่างหัวท้าย) โดน 23505 → ข้อความไทยไม่มี SQL', async () => {
  const before = await countRows('accounts');
  await addAccount(db, SESSION_1, { name: 'Cash', kind: 'cash' });

  const duplicates: { input: Record<string, unknown>; why: string }[] = [
    { input: { name: 'Cash', kind: 'bank' }, why: 'ชื่อเดิมเป๊ะ' },
    { input: { name: 'CASH', kind: 'bank' }, why: 'พิมพ์ใหญ่' },
    { input: { name: '  cash  ', kind: 'bank' }, why: 'ช่องว่างหัวท้าย + พิมพ์เล็ก' },
  ];
  for (const { input, why: label } of duplicates) {
    await assert.rejects(
      () => addAccount(db, SESSION_1, input),
      (error: unknown) =>
        error instanceof ValidationError &&
        error.message === 'มีชื่อนี้อยู่แล้ว' && // ข้อความไทยล้วน ไม่มี SQL
        /accounts_user_name_uidx/.test(why(error)),
      `ต้องโดน unique: ${label}`,
    );
  }
  assert.equal(await countRows('accounts'), before + 1, 'มีแต่แถวแรกที่เข้า');

  // ชื่อเดิมของ u2 ไม่ชนกับ u1 (unique ผูกกับผู้ใช้)
  await addAccount(db, SESSION_2, { name: 'Cash', kind: 'cash' });

  // archive ตัวเดิมแล้วใช้ชื่อซ้ำได้อีก (unique เป็น partial: where archived_at is null)
  const mine = (await listAccounts(db, U1)).find((row) => row.name === 'Cash');
  assert.ok(mine);
  await archiveAccount(db, SESSION_1, mine.id);
  const reused = await addAccount(db, SESSION_1, { name: 'Cash', kind: 'cash' });
  assert.equal(reused.name, 'Cash');
});

test('initial_balance: ติดลบได้ (บัตรเครดิต) · เกิน ±1e15 หรือชนิดผิดถูกปฏิเสธก่อนถึง DB', async () => {
  const card = await addAccount(db, SESSION_1, {
    name: 'บัตรเครดิต',
    kind: 'credit',
    initialBalance: -250000, // ยอดค้างจ่าย
  });
  assert.equal(card.initialBalance, -250000);
  assert.equal(Number((await rawAccount(card.id)).initial_balance), -250000);

  const before = await countRows('accounts');
  const bad = [
    { initialBalance: 1_000_000_000_000_000, expect: /เกินช่วง/ },
    { initialBalance: -1_000_000_000_000_000, expect: /เกินช่วง/ },
    { initialBalance: 12.5, expect: /สตางค์จำนวนเต็ม/ },
    { initialBalance: '100', expect: /number/ },
  ];
  for (const { initialBalance, expect } of bad) {
    await assert.rejects(
      () => addAccount(db, SESSION_1, { name: `บัญชี ${String(initialBalance)}`, initialBalance }),
      (error: unknown) => error instanceof ValidationError && expect.test(error.message),
      `ต้องปฏิเสธ initialBalance = ${String(initialBalance)}`,
    );
  }
  assert.equal(await countRows('accounts'), before, 'input ผิดต้องไม่แตะ DB');
  // validate ล้วน ๆ ก็ต้องโยนแบบ sync
  assert.throws(() => validateAccount({ name: 'x', initialBalance: 1e16 }), ValidationError);
});

test('kind/currency/ฟิลด์ต้องห้าม ถูกปฏิเสธ · userId มาจาก session เท่านั้น', async () => {
  const before = await countRows('accounts');
  const bad: { input: Record<string, unknown>; expect: RegExp; why: string }[] = [
    { input: { name: 'กระเป๋าใหม่', kind: 'crypto' }, expect: /kind ต้องเป็น/, why: 'kind นอกลิสต์ของ DB' },
    { input: { name: 'กระเป๋าใหม่', currency: 'USD' }, expect: /ไม่อนุญาต/, why: 'currency ตรึง THB' },
    { input: { name: 'กระเป๋าใหม่', userId: U2 }, expect: /ไม่อนุญาต/, why: 'userId จาก input' },
    { input: { name: 'กระเป๋าใหม่', archivedAt: new Date() }, expect: /ไม่อนุญาต/, why: 'archivedAt จาก input' },
    { input: { name: '   ' }, expect: /ชื่อกระเป๋า/, why: 'ชื่อมีแต่ช่องว่าง' },
    { input: { kind: 'cash' }, expect: /ชื่อกระเป๋า/, why: 'ไม่มีชื่อ' },
    { input: { name: 'ก', icon: 42 }, expect: /ไอคอน/, why: 'ไอคอนไม่ใช่ข้อความ' },
  ];
  for (const { input, expect, why: label } of bad) {
    await assert.rejects(
      () => addAccount(db, SESSION_1, input),
      (error: unknown) => error instanceof ValidationError && expect.test(error.message),
      `ต้องปฏิเสธ: ${label}`,
    );
  }
  assert.equal(await countRows('accounts'), before);
  for (const notObject of [null, 'x', 42, []]) {
    await assert.rejects(() => addAccount(db, SESSION_1, notObject), ValidationError);
  }
});

test('ข้ามผู้ใช้: เห็น/แก้/archive ของคนอื่นไม่ได้ และกระเป๋าต้องเป็นของผู้ใช้คนนั้นจริง', async () => {
  const mine = await addAccount(db, SESSION_1, { name: 'ของฉัน', kind: 'cash' });
  const theirs = await addAccount(db, SESSION_2, { name: 'ของเขา', kind: 'cash' });

  // ลิสต์แยกกันจริง: u2 เห็นของตัวเอง และไม่มี id ของ u1 หลุดไปฝั่งเขา (และกลับกัน)
  const mineList = await listAccounts(db, U1);
  const theirsList = await listAccounts(db, U2);
  assert.ok(theirsList.some((row) => row.id === theirs.id), 'u2 ต้องเห็นของตัวเอง');
  assert.equal(mineList.some((row) => row.id === theirs.id), false, 'u1 ต้องไม่เห็นของ u2');
  const mineIds = new Set(mineList.map((row) => row.id));
  assert.equal(theirsList.some((row) => mineIds.has(row.id)), false, 'u2 ต้องไม่เห็นของ u1');

  for (const attempt of [
    () => updateAccount(db, SESSION_1, theirs.id, { name: 'แก้ของเขา' }),
    () => archiveAccount(db, SESSION_1, theirs.id),
  ]) {
    await assert.rejects(
      attempt,
      (error: unknown) => error instanceof ValidationError && /ไม่พบกระเป๋านี้/.test(error.message),
    );
  }
  // ของ u2 ต้องไม่ถูกแตะ
  const untouched = await rawAccount(theirs.id);
  assert.equal(untouched.name, 'ของเขา');
  assert.equal(untouched.archived_at, null);

  // รายการของ u1 อ้างกระเป๋าของ u2 ไม่ได้ (composite FK ของ DB — ผ่าน validate แต่ DB ปฏิเสธ)
  const category = await pglite.query<{ id: string }>(
    `insert into categories (user_id, kind, name) values ('${U1}', 'expense', 'อาหาร') returning id`,
  );
  await assert.rejects(
    () =>
      addTransaction(db, SESSION_1, {
        kind: 'expense',
        amount: 10000,
        accountId: theirs.id,
        categoryId: category.rows[0].id,
      }),
    (error: unknown) =>
      error instanceof ValidationError && /accounts_id_user_id_key|account_id_user_id_fkey/.test(why(error)),
  );

  // กระเป๋าที่ archive แล้ว: หายจากลิสต์ active แต่รายการเก่ายังอ้างได้และยังถูกนับในยอดเดือน
  const old = await addAccount(db, SESSION_1, { name: 'กระเป๋าเก่า', kind: 'cash' });
  await addTransaction(db, SESSION_1, {
    kind: 'expense',
    amount: 30000,
    accountId: old.id,
    categoryId: category.rows[0].id,
    occurredAt: '2026-09-05T10:00:00+07:00',
  });
  await archiveAccount(db, SESSION_1, old.id);
  assert.equal((await listAccounts(db, U1)).some((row) => row.id === old.id), false, 'ต้องหายจากลิสต์ active');
  assert.equal((await monthTotals(db, U1, '2026-09-01')).expense, 30000, 'รายการเก่ายังนับอยู่');
  assert.equal(await countRows('transactions'), 1, 'แถวรายการต้องไม่หายไปกับกระเป๋าที่ archive');

  // แต่แก้กระเป๋าที่ archive แล้วไม่ได้
  await assert.rejects(
    () => updateAccount(db, SESSION_1, old.id, { name: 'ปลุกคืน' }),
    (error: unknown) => error instanceof ValidationError && /ไม่พบกระเป๋านี้/.test(error.message),
  );
  assert.equal((await rawAccount(mine.id)).archived_at, null);
});
