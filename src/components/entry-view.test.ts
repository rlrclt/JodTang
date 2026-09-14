/**
 * เทสต์ตรรกะของชีตเพิ่มรายการ — รัน: node --test src/components/entry-view.test.ts
 * ครอบ acceptance 1–4 ของ wave 10b: เดากระเป๋า/หมวดข้าม kind, 0 กระเป๋า, โอนต้องมี 2 ใบ
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bangkokDateFromValue,
  bangkokDateValue,
  bangkokTodayValue,
  bangkokYesterdayValue,
  type EntryOptions,
  SETUP_CATEGORIES,
  SUGGESTED_CATEGORY_NAMES,
  canTransferWith,
  defaultAccountId,
  defaultCategoryId,
  entryBlockReason,
} from './entry-view.ts';

const options = (over: Partial<EntryOptions> = {}): EntryOptions => ({
  accounts: [
    { id: 'a1', name: 'เงินสด' },
    { id: 'a2', name: 'ธนาคาร' },
  ],
  categories: {
    income: [{ id: 'i1', name: 'เงินเดือน', color: '--chart-4' }],
    expense: [
      { id: 'e1', name: 'อาหาร', color: '--chart-6' },
      { id: 'e2', name: 'เดินทาง', color: '--chart-5' },
    ],
  },
  lastUsedAccountId: null,
  suggested: { income: null, expense: null },
  ...over,
});

test('กระเป๋าเริ่มต้น: ใช้ใบล่าสุดเมื่อยังอยู่ในลิสต์ · ไม่มีก็ใบแรก', () => {
  assert.equal(defaultAccountId(options({ lastUsedAccountId: 'a2' })), 'a2');
  assert.equal(defaultAccountId(options({ lastUsedAccountId: null })), 'a1');
});

test('กระเป๋าเริ่มต้น: lastUsed ชี้ใบที่ archive/หายไป → ตกไปใบแรก (ไม่เลือกของที่ไม่มีในลิสต์)', () => {
  assert.equal(defaultAccountId(options({ lastUsedAccountId: 'a99' })), 'a1');
});

test('กระเป๋าเริ่มต้น: ไม่มีกระเป๋าเลย → null', () => {
  assert.equal(defaultAccountId(options({ accounts: [] })), null);
});

test('หมวดเริ่มต้น: ใช้ค่าที่เดามาเมื่อยังอยู่ · ไม่มีก็หมวดแรกของ kind', () => {
  assert.equal(defaultCategoryId(options({ suggested: { income: null, expense: 'e2' } }), 'expense'), 'e2');
  assert.equal(defaultCategoryId(options(), 'expense'), 'e1');
  assert.equal(defaultCategoryId(options(), 'income'), 'i1');
});

test('สลับ kind → ได้หมวดของ kind นั้น ไม่ค้างของเดิม (acceptance 3)', () => {
  const opts = options({ suggested: { income: null, expense: 'e2' } });
  assert.equal(defaultCategoryId(opts, 'expense'), 'e2');
  assert.equal(defaultCategoryId(opts, 'income'), 'i1');
  assert.notEqual(defaultCategoryId(opts, 'expense'), defaultCategoryId(opts, 'income'));
});

test('หมวดที่เดามาเป็นของอีก kind (ค่าผิด) → ไม่ใช้ ตกไปหมวดแรกของ kind ที่ขอ', () => {
  assert.equal(defaultCategoryId(options({ suggested: { income: null, expense: 'i1' } }), 'expense'), 'e1');
});

test('kind ที่ไม่มีหมวดเลย → null (UI ต้องเสนอให้สร้าง)', () => {
  assert.equal(defaultCategoryId(options({ categories: { income: [], expense: [] } }), 'expense'), null);
});

test('โอนได้เฉพาะเมื่อมีกระเป๋า ≥ 2', () => {
  assert.equal(canTransferWith(0), false);
  assert.equal(canTransferWith(1), false);
  assert.equal(canTransferWith(2), true);
});

test('เหตุผลที่บันทึกไม่ได้: 0 กระเป๋า ต้องบอกให้สร้างก่อน', () => {
  const reason = entryBlockReason({ kind: 'expense', amountSatang: 100, accountId: null, toAccountId: null, categoryId: 'e1', accountCount: 0 });
  assert.match(reason ?? '', /ยังไม่มีกระเป๋า/);
});

test('เหตุผล: โอนต้องมี ≥2 ใบ · ต้องเลือกปลายทาง · ปลายทางต้องต่างจากต้นทาง', () => {
  const base = { kind: 'transfer' as const, amountSatang: 100, accountId: 'a1', categoryId: null };
  assert.match(entryBlockReason({ ...base, toAccountId: null, accountCount: 2 }) ?? '', /เลือกกระเป๋าปลายทาง/);
  assert.match(entryBlockReason({ ...base, toAccountId: 'a1', accountCount: 2 }) ?? '', /ปลายทางต้องไม่ใช่/);
  assert.match(entryBlockReason({ ...base, toAccountId: 'a2', accountCount: 1 }) ?? '', /อย่างน้อย 2 กระเป๋า/);
  assert.equal(entryBlockReason({ ...base, toAccountId: 'a2', accountCount: 2 }), null);
});

test('เหตุผล: รับ/จ่ายต้องมีหมวด (ห้ามบันทึกก่อนแล้วค่อยแก้)', () => {
  const base = { kind: 'expense' as const, amountSatang: 100, accountId: 'a1', toAccountId: null, accountCount: 2 };
  assert.match(entryBlockReason({ ...base, categoryId: null }) ?? '', /เลือกหมวด/);
  assert.equal(entryBlockReason({ ...base, categoryId: 'e1' }), null);
});

test('โอนไม่ต้องมีหมวด (categoryId = null ได้)', () => {
  const reason = entryBlockReason({ kind: 'transfer', amountSatang: 100, accountId: 'a1', toAccountId: 'a2', categoryId: null, accountCount: 2 });
  assert.equal(reason, null);
});

test('แผนเริ่มใช้งานเร็ว: 5 หมวด ชื่อชุดเดียวกับ SUGGESTED_CATEGORY_NAMES (ไม่คิดชุดที่สอง)', () => {
  const names = SETUP_CATEGORIES.map((item) => item.name);
  const expected = [...SUGGESTED_CATEGORY_NAMES.expense, ...SUGGESTED_CATEGORY_NAMES.income];
  assert.deepEqual(names, expected);
  assert.equal(SETUP_CATEGORIES.length, 5);
});

test('แผนเริ่มใช้งานเร็ว: หมวดรายจ่ายห้ามได้เฉดเขียว (--chart-4/--chart-7) — design §1.1', () => {
  const expense = SETUP_CATEGORIES.filter((item) => item.kind === 'expense');
  assert.ok(expense.every((item) => item.color !== '--chart-4' && item.color !== '--chart-7'), JSON.stringify(expense));
  // และต้องมีสีจริงทุกตัว (ไม่ปล่อย null หลุดไป)
  assert.ok(SETUP_CATEGORIES.every((item) => item.color !== null));
});

test('แผนเริ่มใช้งานเร็ว: รายรับใช้เฉดเขียวได้ (ตามสเปก wave12 §2)', () => {
  const income = SETUP_CATEGORIES.filter((item) => item.kind === 'income').map((item) => item.color);
  assert.deepEqual(income, ['--chart-4', '--chart-7']);
});

// --- วันที่ไทยของชีตแก้รายการ (wave17) ---
// เส้นแบ่งวันที่คือหัวใจ: 18:00Z ของวันที่ 13 = 01:00 น. วันที่ 14 ตามเวลาไทย → ต้องได้ 2026-09-14
test('bangkokDateValue: อ่านวันที่ตามปฏิทินไทย ไม่ใช่วันที่ของเครื่อง', () => {
  assert.equal(bangkokDateValue(new Date('2026-09-13T18:00:00Z')), '2026-09-14');
  assert.equal(bangkokDateValue(new Date('2026-09-13T16:59:00Z')), '2026-09-13');
  assert.equal(bangkokDateValue(new Date('2026-09-13T17:00:00Z')), '2026-09-14');
});

test('bangkokDateFromValue: ค่าไป-กลับได้ และปฏิเสธวันที่ที่ไม่มีจริง', () => {
  const at = bangkokDateFromValue('2026-09-14');
  assert.ok(at);
  assert.equal(bangkokDateValue(at), '2026-09-14');
  assert.equal(bangkokDateFromValue('2026-02-31'), null); // JS จะเลื่อนเป็น 3 มี.ค. ถ้าไม่กัน
  assert.equal(bangkokDateFromValue('14/09/2026'), null);
  assert.equal(bangkokDateFromValue(''), null);
});

test('ปุ่มลัด วันนี้/เมื่อวาน: ใช้เวลาไทย และข้ามเดือนถูกต้อง', () => {
  const morning = new Date('2026-10-01T01:00:00+07:00');
  assert.equal(bangkokTodayValue(morning), '2026-10-01');
  assert.equal(bangkokYesterdayValue(morning), '2026-09-30'); // ข้ามเดือน
  assert.equal(bangkokYesterdayValue(new Date('2026-09-14T06:00:00Z')), '2026-09-13'); // 13:00 ไทย
});
