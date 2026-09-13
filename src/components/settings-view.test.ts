/**
 * เทสต์ตรรกะบริสุทธิ์ของหน้าจัดการหมวด/กระเป๋า — รัน: node --test src/components/settings-view.test.ts
 * ครอบเกณฑ์ที่ reviewer วัดได้: picker ของ expense ต้องไม่มีเฉดเขียว + ป้ายต้องไม่เรียก chart-6 ว่า "เขียว"
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_KIND_LABELS,
  ACCOUNT_KIND_OPTIONS,
  CHART_TOKENS,
  CATEGORY_KIND_LABELS,
  colorLabel,
  colorOptionsFor,
  splitByArchived,
} from './settings-view.ts';

test('expense: เสนอ 6 สี และไม่มีเขียว (--chart-4 / --chart-7)', () => {
  const options = colorOptionsFor('expense');
  assert.equal(options.length, 6);
  assert.ok(!options.includes('--chart-4'));
  assert.ok(!options.includes('--chart-7'));
  // chart-6 เป็นเขียวน้ำทะเล → อนุญาต (spec §3)
  assert.ok(options.includes('--chart-6'));
});

test('income: เสนอครบทั้ง 8 สี', () => {
  assert.deepEqual([...colorOptionsFor('income')], [...CHART_TOKENS]);
});

test('ป้ายสีของ --chart-6 ต้องไม่ใช่คำว่า "เขียว" เฉย ๆ (เป็นฟ้าเขียว)', () => {
  assert.equal(colorLabel('--chart-6'), 'ฟ้าเขียว');
  assert.notEqual(colorLabel('--chart-6'), 'เขียว');
  assert.equal(colorLabel('--chart-4'), 'เขียว');
});

test('สีที่ไม่รู้จัก → คืนชื่อโทเคนเดิม (ไม่ทำให้พัง)', () => {
  assert.equal(colorLabel('--chart-99'), '--chart-99');
});

test('ชนิดกระเป๋าครบ 5 ชนิด พร้อมป้ายไทย', () => {
  assert.deepEqual(Object.keys(ACCOUNT_KIND_LABELS).sort(), ['bank', 'cash', 'credit', 'ewallet', 'other']);
  assert.deepEqual(
    ACCOUNT_KIND_OPTIONS.map((option) => option.label),
    ['เงินสด', 'ธนาคาร', 'บัตรเครดิต', 'กระเป๋าเงินอิเล็กทรอนิกส์', 'อื่น ๆ'],
  );
});

test('ป้ายประเภทรายหมวด', () => {
  assert.equal(CATEGORY_KIND_LABELS.income, 'รายรับ');
  assert.equal(CATEGORY_KIND_LABELS.expense, 'รายจ่าย');
});

test('แยกกลุ่ม active/เลิกใช้แล้ว โดยคงลำดับเดิมภายในกลุ่ม', () => {
  const rows = [
    { id: 'a', archived: false },
    { id: 'b', archived: true },
    { id: 'c', archived: false },
    { id: 'd', archived: true },
  ];
  const { active, archived } = splitByArchived(rows);
  assert.deepEqual(active.map((row) => row.id), ['a', 'c']);
  assert.deepEqual(archived.map((row) => row.id), ['b', 'd']);
});

test('ไม่มีแถวเลย → ทั้งสองกลุ่มว่าง', () => {
  assert.deepEqual(splitByArchived([]), { active: [], archived: [] });
});
