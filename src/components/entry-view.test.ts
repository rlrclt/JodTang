/**
 * เทสต์ตรรกะของชีตเพิ่มรายการ — รัน: node --test src/components/entry-view.test.ts
 * ครอบ acceptance 1–4 ของ wave 10b: เดากระเป๋า/หมวดข้าม kind, 0 กระเป๋า, โอนต้องมี 2 ใบ
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type EntryOptions,
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
