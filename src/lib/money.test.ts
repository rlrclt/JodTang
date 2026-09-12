/**
 * เทสต์สั้นของกติกาเงิน — รัน: node --test src/lib/money.test.ts
 * จุดสำคัญ: transfer 100000 สตางค์ ต้องไม่โผล่ในยอดรับ/ยอดจ่าย แต่ต้องย้ายยอดระหว่างกระเป๋า
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  accountBalance,
  formatRowAmount,
  formatSatang,
  isCounted,
  periodTotals,
  toSatang,
} from "./money.ts";
import type { MoneyRow } from "./money.ts";

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

/* ---- เคสที่ reviewer สั่งเพิ่ม (fail-open + safe integer) ---- */

test("ยอดรวมหลุดช่วง safe integer ต้อง throw ไม่ใช่คืนยอดเพี้ยน", () => {
  const cap = 1_000_000_000_000_000 - 1; // เพดาน amount ของ schema.sql คือ < 1e15
  const rows = Array.from({ length: 11 }, () => ({
    kind: "income",
    amount: cap,
    accountId: A,
    deletedAt: null,
  })) as unknown as MoneyRow[];
  // 11 × (1e15−1) = 1.1e16 > 2^53 → ยอดเพี้ยนจริง 1 สตางค์ จึงต้องล้ม ไม่ใช่คืนค่า
  assert.throws(() => periodTotals(rows), RangeError);
  assert.throws(() => accountBalance(rows, A), RangeError);
  // 5 แถวยังอยู่ในช่วง → ไม่ throw และยอดต้องตรง
  assert.equal(periodTotals(rows.slice(0, 5)).income, 4_999_999_999_999_995);
});

test("formatSatang(1e16) และ initialBalance เพี้ยน ต้อง throw", () => {
  assert.throws(() => formatSatang(1e16), TypeError); // เดิม (isInteger) ไม่ throw — 1e16 เป็นจำนวนเต็มแต่เกิน safe integer
  assert.throws(() => formatSatang(Number.MAX_SAFE_INTEGER + 2), TypeError);
  assert.throws(() => accountBalance([], A, 12.5), TypeError);
  assert.throws(() => accountBalance([], A, 1e16), TypeError);
  assert.equal(accountBalance([], A, Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER); // ขอบบนที่ยังปลอดภัย = ผ่าน
});

test("fail-open ที่ปิดแล้ว: deletedAt '' · kind ที่ไม่รู้จัก · transfer ไม่มีปลายทาง", () => {
  // สตริงว่าง '' ต้องถือว่า "ลบแล้ว" ไม่ใช่ "ยังไม่ลบ"
  assert.equal(isCounted({ kind: "income", amount: 1, accountId: A, deletedAt: "" }), false);
  assert.equal(periodTotals([{ kind: "income", amount: 500, accountId: A, deletedAt: "" }]).income, 0);
  assert.equal(accountBalance([{ kind: "income", amount: 500, accountId: A, deletedAt: "" }], A), 0);
  // kind ที่ไม่รู้จัก (ข้อมูลเพี้ยน/ยิง API ตรง) ต้องไม่ถูกหักเงินราวกับเป็น transfer
  const weird = {
    kind: "refund",
    amount: 700,
    accountId: A,
    toAccountId: null,
    deletedAt: null,
  } as unknown as MoneyRow;
  assert.equal(accountBalance([weird], A), 0);
  assert.deepEqual(periodTotals([weird]), { income: 0, expense: 0, balance: 0 });
  // transfer ที่ไม่มีปลายทาง: หักฝั่งต้นทางเท่านั้น (DB กันด้วย transactions_shape_ck)
  const halfTransfer = {
    kind: "transfer",
    amount: 1_000,
    accountId: A,
    toAccountId: null,
    deletedAt: null,
  } as unknown as MoneyRow;
  assert.equal(accountBalance([halfTransfer], A), -1_000);
  assert.equal(accountBalance([halfTransfer], B), 0);
});

test("ยอดคงเหลือตรงเป๊ะทีละตัวเลข (ไม่ assert ด้วยนิพจน์เดียวกับสูตรในโค้ด)", () => {
  assert.equal(accountBalance(ROWS, A, 1_000), 111_000); // 1000 + 250000 − 40000 − 100000
  assert.equal(accountBalance(ROWS, A), 110_000);
  assert.equal(accountBalance(ROWS, B), 100_000);
  assert.equal(accountBalance(ROWS, A, 1_000) + accountBalance(ROWS, B), 211_000);
});

/* ---- เคสที่ verifier เจอ: เงินเป็น string แล้วต่อกันเงียบ ๆ (ยอดผิดแต่ไม่มี error) ---- */

test("amount เป็น string ต้อง throw ไม่ใช่ต่อสตริงเงียบ ๆ", () => {
  const strRows = [
    { kind: "income", amount: "2450000", accountId: A, deletedAt: null },
    { kind: "expense", amount: "1284000", accountId: A, deletedAt: null },
  ] as unknown as MoneyRow[];
  // เดิม: initial 100 + '2450000' + '1284000' → คืน "1,001,166,000" (ผิดเงียบ ๆ) ตอนนี้ต้องล้ม
  assert.throws(() => accountBalance(strRows, A, 100), TypeError);
  assert.throws(() => periodTotals(strRows), TypeError);
  assert.throws(() => toSatang("2450000"), TypeError);
  assert.throws(() => toSatang("0"), TypeError); // แม้สตริงที่ดูเหมือนศูนย์ก็ต้องไม่ผ่าน
});

test("amount เป็น BigInt (หรือค่าที่ไม่ใช่ number) ต้อง throw", () => {
  assert.throws(() => toSatang(BigInt(1)), TypeError);
  assert.throws(() => toSatang(null), TypeError);
  const bigRows = [
    { kind: "income", amount: BigInt(1), accountId: A, deletedAt: null },
  ] as unknown as MoneyRow[];
  assert.throws(() => accountBalance(bigRows, A), TypeError);
  assert.throws(() => periodTotals(bigRows), TypeError);
  // ค่าที่ถูกต้องยังได้ยอดตรงเป๊ะ: 100 + 2450000 − 1284000 = 1166100
  assert.equal(
    accountBalance(
      [
        { kind: "income", amount: 2_450_000, accountId: A, deletedAt: null },
        { kind: "expense", amount: 1_284_000, accountId: A, deletedAt: null },
      ],
      A,
      100,
    ),
    1_166_100,
  );
});
