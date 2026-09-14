/**
 * เทสต์ตรรกะของชีตเพิ่มรายการ — รัน: node --test src/components/entry-view.test.ts
 * ครอบ acceptance 1–4 ของ wave 10b: เดากระเป๋า/หมวดข้าม kind, 0 กระเป๋า, โอนต้องมี 2 ใบ
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bangkokDateAt,
  bangkokDateValue,
  bangkokTimeValue,
  entryErrorField,
  occurredAtForEdit,
  prefillEditForm,
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

test('bangkokDateAt: ค่าไป-กลับได้ และปฏิเสธวันที่ที่ไม่มีจริง', () => {
  const at = bangkokDateAt('2026-09-14');
  assert.ok(at);
  assert.equal(bangkokDateValue(at), '2026-09-14');
  assert.equal(bangkokDateAt('2026-02-31'), null); // JS จะเลื่อนเป็น 3 มี.ค. ถ้าไม่กัน
  assert.equal(bangkokDateAt('14/09/2026'), null);
  assert.equal(bangkokDateAt(''), null);
  assert.equal(bangkokDateAt('2026-09-14', '25:00:00'), null);
});

test('bangkokTimeValue: เวลาไทยของจุดเวลา (ไม่ใช่เวลาของเครื่อง)', () => {
  assert.equal(bangkokTimeValue(new Date('2026-09-14T01:30:45Z')), '08:30:45');
  assert.equal(bangkokTimeValue(new Date('2026-09-13T17:00:00Z')), '00:00:00');
});

test('occurredAtForEdit: แก้แค่วันอื่น (ไม่แตะวันที่) → เวลาเดิมไม่ถูกแตะเลย', () => {
  const original = new Date('2026-09-14T01:30:45Z'); // 08:30:45 ไทย
  const same = occurredAtForEdit(original, '2026-09-14');
  assert.strictEqual(same, original, 'วันเดิมต้องคืนจุดเวลาเดิมทั้งก้อน ไม่ใช่ 12:00');
});

test('occurredAtForEdit: เปลี่ยนวันจริง → ยกเวลาเดิมไปวันใหม่ (ไม่ใช่เที่ยงวัน)', () => {
  const original = new Date('2026-09-14T01:30:45Z'); // 08:30:45 ไทย
  const moved = occurredAtForEdit(original, '2026-08-20');
  assert.ok(moved);
  assert.equal(bangkokDateValue(moved), '2026-08-20');
  assert.equal(bangkokTimeValue(moved), '08:30:45');
  assert.equal(occurredAtForEdit(original, '2026-02-31'), null);
});

test('ปุ่มลัด วันนี้/เมื่อวาน: ใช้เวลาไทย และข้ามเดือนถูกต้อง', () => {
  const morning = new Date('2026-10-01T01:00:00+07:00');
  assert.equal(bangkokTodayValue(morning), '2026-10-01');
  assert.equal(bangkokYesterdayValue(morning), '2026-09-30'); // ข้ามเดือน
  assert.equal(bangkokYesterdayValue(new Date('2026-09-14T06:00:00Z')), '2026-09-13'); // 13:00 ไทย
});

test('occurredAtForEdit: แก้แค่วันที่ไทยเดียวกันแต่ยังเป็นวันเดียวกันใน UTC → ยังคงเวลาเดิม', () => {
  // 2026-09-14T18:00Z = 01:00 วันที่ 15 ตามเวลาไทย → วันที่ไทยคือ 15
  const lateNight = new Date('2026-09-14T18:00:00Z');
  assert.equal(bangkokDateValue(lateNight), '2026-09-15');
  assert.strictEqual(occurredAtForEdit(lateNight, '2026-09-15'), lateNight);
  const moved = occurredAtForEdit(lateNight, '2026-09-16');
  assert.ok(moved);
  assert.equal(bangkokTimeValue(moved), '01:00:00');
});

test('entryErrorField: map ข้อความ error ไทย → ช่องที่ผิด (ใช้คุม aria-invalid รายช่อง)', () => {
  assert.equal(entryErrorField('โน้ตยาวเกิน 500 ตัวอักษร'), 'note');
  assert.equal(entryErrorField('จำนวนเงินต้องมากกว่า 0'), 'amount');
  assert.equal(entryErrorField('วันที่ไม่ถูกต้อง'), 'date');
  assert.equal(entryErrorField('รับ/จ่ายต้องระบุหมวด'), 'category');
  assert.equal(entryErrorField('โอนต้องระบุกระเป๋าปลายทาง'), 'toAccount'); // 'ปลายทาง' ต้องมาก่อน 'กระเป๋า'
  assert.equal(entryErrorField('ต้องมีกระเป๋าอย่างน้อย 1 ใบ'), 'account');
  // ไม่รู้จัก/ไม่ใช่ความผิดของช่องไหน → null (ห้ามประทับช่องผิด)
  assert.equal(entryErrorField('ไม่พบรายการนี้ (อาจถูกลบไปแล้วหรือไม่ใช่ของคุณ)'), null);
  assert.equal(entryErrorField('เซสชันหมดอายุ — เข้าสู่ระบบใหม่แล้วลองอีกครั้ง'), null);
  assert.equal(entryErrorField('บันทึกการแก้ไขไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)'), null);
});

// --- wave22: prefill ต้องไม่ทับสิ่งที่ผู้ใช้พิมพ์ระหว่างรอโหลด ---
const SERVER_FORM = {
  kind: 'expense' as const,
  amount: '123.45',
  accountId: 'acc-server',
  toAccountId: null,
  categoryId: 'cat-server',
  note: 'โน้ตเดิม',
  date: '2026-09-14',
};
const USER_FORM = {
  kind: 'expense' as const,
  amount: '200.00',
  accountId: null,
  toAccountId: null,
  categoryId: null,
  note: 'พิมพ์ระหว่างรอ',
  date: '',
};

test('prefillEditForm: ช่องที่ผู้ใช้แก้ระหว่างรอโหลด ต้องคงค่าที่ผู้ใช้พิมพ์ (บั๊ก cold start)', () => {
  const merged = prefillEditForm(SERVER_FORM, USER_FORM, new Set(['amount', 'note']));
  assert.equal(merged.amount, '200.00', 'จำนวนที่พิมพ์ต้องไม่ถูกทับด้วยค่าจาก server');
  assert.equal(merged.note, 'พิมพ์ระหว่างรอ');
  // ช่องที่ยังไม่แตะ = รับค่าจาก server (ฟอร์มยัง prefill ครบ)
  assert.equal(merged.accountId, 'acc-server');
  assert.equal(merged.categoryId, 'cat-server');
  assert.equal(merged.date, '2026-09-14');
});

test('prefillEditForm: ไม่มีใครแตะ → ได้ค่าจาก server ทั้งชุด', () => {
  assert.deepEqual(prefillEditForm(SERVER_FORM, USER_FORM, new Set()), SERVER_FORM);
});

test('prefillEditForm: kind รับจาก server เสมอ (โหมดแก้แก้ทิศทางไม่ได้)', () => {
  const merged = prefillEditForm(SERVER_FORM, { ...USER_FORM, kind: 'income' }, new Set(['amount']));
  assert.equal(merged.kind, 'expense');
});
