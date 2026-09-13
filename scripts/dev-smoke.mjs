#!/usr/bin/env node
/**
 * พิสูจน์ว่า dev DB (PGlite ที่ ./.pglite) ทำงานครบวงจรจริงโดยไม่ต้องมี credential ของ Neon
 *
 * รัน: node scripts/dev-smoke.mjs      (จาก root ของโปรเจกต์)
 *
 * สคริปต์นี้ทำ 4 อย่าง แล้วลบข้อมูลที่สร้างทิ้ง:
 *   1. เปิด DB ผ่าน getDb() ของแอป (src/db/index.ts) — เส้นทางเดียวกับที่แอปใช้จริง
 *   2. สร้างผู้ใช้ → กระเป๋า → หมวด ผ่าน src/db/mutations (ไม่ยิง SQL เอง ยกเว้นแถว "user" ที่ Better Auth เป็นเจ้าของ)
 *   3. addTransaction 2 รายการ (รับ 30,000.00 · จ่าย 1,284.00) แล้วอ่านกลับด้วย monthTotals/recentTransactions
 *   4. assert ยอดที่อ่านได้ตรงกับที่คาด แล้วลบข้อมูลทั้งหมดทิ้ง
 *
 * ตั้งใจไม่ใช้ DATABASE_URL: สคริปต์ลบตัวแปรทิ้งก่อนเรียก getDb() เพื่อบังคับเส้นทาง dev fallback
 * (ถ้าเครื่องไหนมี DATABASE_URL อยู่ใน shell สคริปต์นี้จะไม่ไปเขียนใส่ Neon เด็ดขาด)
 */
import assert from 'node:assert/strict';

const hadDatabaseUrl = Boolean(process.env.DATABASE_URL);
delete process.env.DATABASE_URL;

// dynamic import: ต้องลบ env ให้เสร็จก่อน ถึงจะเรียก getDb() ได้ (index.ts อ่าน env ตอนเรียก ไม่ใช่ตอน import)
const { getDb } = await import('../src/db/index.ts');
const { closeDevDb, DEV_DB_DIR } = await import('../src/db/dev-pglite.ts');
const { addAccount } = await import('../src/db/mutations/accounts.ts');
const { addCategory } = await import('../src/db/mutations/categories.ts');
const { addTransaction } = await import('../src/db/mutations/transactions.ts');
const { monthTotals, recentTransactions } = await import('../src/db/queries/transactions.ts');
const { accounts, categories, transactions, user } = await import('../src/db/schema.ts');
const { eq } = await import('drizzle-orm');

/** เดือนไทยที่ใช้ทดสอบ (occurred_month_bkk) — วันของรายการถูกกำหนดตายตัว จึงได้ผลเดิมทุกครั้งที่รัน */
const PERIOD = '2026-09-01';
const INCOME_SATANG = 3_000_000; // 30,000.00 บาท
const EXPENSE_SATANG = 128_400; //  1,284.00 บาท
const EXPECTED = {
  income: INCOME_SATANG,
  expense: EXPENSE_SATANG,
  balance: INCOME_SATANG - EXPENSE_SATANG,
};

/** ตั้งใจให้ไม่ชนกับข้อมูลเดิม: ผู้ใช้ใหม่ทุกครั้งที่รัน (เผื่อรอบก่อนหน้าลบไม่หมด) */
const USER_ID = `smoke-${Date.now()}`;
const session = { userId: USER_ID };

const baht = (satang) =>
  (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

if (hadDatabaseUrl) {
  console.log('หมายเหตุ: เจอ DATABASE_URL ใน env — สคริปต์นี้ลบทิ้งเพื่อทดสอบ dev DB (ไม่แตะ Neon)');
}
console.log(`dev DB: ${DEV_DB_DIR}`);

const db = getDb();
let failure;

try {
  // 1) ผู้ใช้ — แถวนี้ Better Auth เป็นเจ้าของ (ไม่มี mutation ใน src/db/mutations) จึง insert ผ่าน schema
  await db.insert(user).values({ id: USER_ID, name: 'ผู้ใช้ทดสอบ (dev-smoke)' });

  // 2) กระเป๋า + หมวด ผ่าน mutation จริง
  const cash = await addAccount(db, session, { name: 'เงินสด', kind: 'cash', initialBalance: 0 });
  const salary = await addCategory(db, session, { kind: 'income', name: 'เงินเดือน' });
  const food = await addCategory(db, session, { kind: 'expense', name: 'อาหาร' });
  console.log(`สร้างแล้ว: กระเป๋า ${cash.id} · หมวด ${salary.id} · ${food.id}`);

  // 3) รายการ ผ่าน mutation จริง (amount เป็นสตางค์จำนวนเต็มตาม src/lib/money.ts)
  const incomeRow = await addTransaction(db, session, {
    kind: 'income',
    amount: INCOME_SATANG,
    accountId: cash.id,
    categoryId: salary.id,
    note: 'เงินเดือน ก.ย.',
    occurredAt: '2026-09-05T09:00:00+07:00',
  });
  const expenseRow = await addTransaction(db, session, {
    kind: 'expense',
    amount: EXPENSE_SATANG,
    accountId: cash.id,
    categoryId: food.id,
    note: 'ข้าวกลางวัน',
    occurredAt: '2026-09-10T19:30:00+07:00',
  });
  assert.equal(incomeRow.amount, INCOME_SATANG, 'ยอดที่ insert กลับมาต้องเท่าที่ส่งไป');
  assert.equal(expenseRow.amount, EXPENSE_SATANG, 'ยอดที่ insert กลับมาต้องเท่าที่ส่งไป');

  // 4) อ่านกลับด้วย query layer จริง
  const totals = await monthTotals(db, USER_ID, PERIOD);
  const recent = await recentTransactions(db, USER_ID, 10);

  console.log(`monthTotals(${PERIOD}): รับ ${baht(totals.income)} · จ่าย ${baht(totals.expense)} · คงเหลือ ${baht(totals.balance)} บาท`);
  console.log(`recentTransactions: ${recent.length} รายการ`);
  for (const row of recent) {
    console.log(`  - ${row.kind.padEnd(7)} ${baht(row.amount).padStart(10)} บาท · ${row.occurredAt.toISOString()}`);
  }

  assert.deepEqual(totals, EXPECTED, 'ยอดเดือนต้องตรงกับที่บันทึก');
  assert.equal(recent.length, 2, 'ต้องเห็น 2 รายการ');
  assert.deepEqual(
    recent.map((row) => row.id),
    [expenseRow.id, incomeRow.id],
    'recent ต้องเรียงใหม่ → เก่า (10 ก.ย. มาก่อน 5 ก.ย.)',
  );
  console.log('ผล: ยอดตรงทั้งหมด ✓');
} catch (error) {
  failure = error;
} finally {
  // ลบข้อมูลที่สร้าง — ลบลูกก่อนพ่อเสมอ (FK ของ transactions ชี้ทั้ง accounts และ categories)
  await db.delete(transactions).where(eq(transactions.userId, USER_ID));
  await db.delete(categories).where(eq(categories.userId, USER_ID));
  await db.delete(accounts).where(eq(accounts.userId, USER_ID));
  await db.delete(user).where(eq(user.id, USER_ID));

  const left = await db.select({ id: user.id }).from(user).where(eq(user.id, USER_ID));
  assert.equal(left.length, 0, 'ลบข้อมูลทดสอบไม่หมด');
  console.log(`ลบข้อมูลทดสอบแล้ว: ผู้ใช้ ${USER_ID} + กระเป๋า + หมวด + รายการ (ไม่เหลือในตาราง user)`);

  await closeDevDb();
}

if (failure) throw failure;
