/**
 * เทสต์สั้นของกติกาเงิน — รัน: node --test src/lib/money.test.ts
 * จุดสำคัญ: transfer 100000 สตางค์ ต้องไม่โผล่ในยอดรับ/ยอดจ่าย แต่ต้องย้ายยอดระหว่างกระเป๋า
 */
import assert from "node:assert/strict";
import test from "node:test";

import { accountBalance, formatRowAmount, formatSatang, isCounted, periodTotals } from "./money.ts";

const A = "acc-a";
const B = "acc-b";

// ยอดตั้งใจเลือกให้ต่างกันทุกตัว เพื่อให้ "transfer รั่ว" ตรวจจับได้ (ถ้ารั่ว income จะกลายเป็น 350000)
const ROWS = [
  { kind: "income", amount: 250_000, accountId: A, toAccountId: null, deletedAt: null },
  { kind: "expense", amount: 40_000, accountId: A, toAccountId: null, deletedAt: null },
  { kind: "transfer", amount: 100_000, accountId: A, toAccountId: B, deletedAt: null },
  { kind: "income", amount: 999_999, accountId: A, toAccountId: null, deletedAt: new Date() },
  { kind: "transfer", amount: 555_555, accountId: B, toAccountId: A, deletedAt: new Date() },
] as const;

test("transfer ไม่โผล่ในยอดรับและยอดจ่าย", () => {
  const t = periodTotals(ROWS);
  assert.deepEqual(t, { income: 250_000, expense: 40_000, balance: 210_000 });
  // ยอด 100000 ของ transfer ต้องไม่ถูกนับเป็นรับหรือจ่าย (และไม่ใช่ผลต่างของทั้งสอง)
  assert.ok(![t.income, t.expense, t.balance].includes(100_000));
  assert.equal(t.income + t.expense, 290_000);
});

test("transfer ย้ายยอด: หักฝั่ง accountId เพิ่มฝั่ง toAccountId", () => {
  assert.equal(accountBalance(ROWS, A, 1_000), 1_000 + 250_000 - 40_000 - 100_000);
  assert.equal(accountBalance(ROWS, B), 100_000);
  // transfer ที่ถูกลบแล้ว (B -> A 555555) ต้องไม่ขยับยอดเลย
  assert.equal(accountBalance(ROWS, A) + accountBalance(ROWS, B), 250_000 - 40_000);
});

test("แถวที่ soft delete แล้วไม่ถูกนับ (ทั้ง rece/expense และ transfer)", () => {
  assert.equal(isCounted({ kind: "transfer", amount: 1, accountId: A, deletedAt: null }), false);
  assert.equal(isCounted({ kind: "income", amount: 1, accountId: A, deletedAt: new Date() }), false);
  assert.equal(isCounted({ kind: "income", amount: 1, accountId: A }), true);
});

test("formatSatang เป็นที่เดียวที่หาร 100 และใส่เครื่องหมายได้", () => {
  assert.match(formatSatang(250_000), /2,500\.00/);
  assert.match(formatSatang(250_000, { signed: true }), /^\+/);
  assert.match(formatSatang(-40_000, { signed: true }), /^[-−]/);
  assert.throws(() => formatSatang(120.5), TypeError); // ไม่ใช่สตางค์จำนวนเต็ม = บั๊ก ต้องล้มเสียงดัง
});

test("เครื่องหมายตามทิศทางตัดสินที่ money.ts ไม่ใช่ที่ component", () => {
  const income = { kind: "income", amount: 250_000 } as const;
  const expense = { kind: "expense", amount: 40_000 } as const;
  const transfer = { kind: "transfer", amount: 100_000 } as const;
  assert.match(formatRowAmount(income), /^\+/);
  assert.match(formatRowAmount(expense), /^[-−]/);
  assert.match(formatRowAmount(transfer), /^[-−]/); // โอน = เงินออกจากกระเป๋าต้นทาง
  assert.equal(formatRowAmount(expense), formatSatang(-40_000, { signed: true }));
});
