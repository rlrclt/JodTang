/**
 * เทสต์ตรรกะบริสุทธิ์ของหน้ารายการ — รัน: node --test src/components/transactions-view.test.ts
 * ครอบบั๊ก 2 ตัวของ wave 8: URL ของ "ล้างตัวกรอง" และเกณฑ์แยกสถานะว่าง (spec §3)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHref, emptyStateFor, searchInputAfterUrlChange } from './transactions-view.ts';

test('ช่องค้นหา: URL เปลี่ยนเพราะ replace ของเราเอง → ไม่แตะสิ่งที่ผู้ใช้พิมพ์', () => {
  // เราสั่ง replace(q='กาแฟ') → prop q กลายเป็น 'กาแฟ' ขณะที่ผู้ใช้พิมพ์ต่อเป็น 'กาแฟเย็น'
  assert.equal(searchInputAfterUrlChange('กาแฟ', 'กาแฟ', 'กาแฟเย็น'), null);
});

test('ช่องค้นหา: "ล้างตัวกรอง" (URL ไม่มี q แล้ว) → ช่องค้นหาต้องว่างตาม URL', () => {
  // repro wave 8: พิมพ์ 'ก.ย. 11' → ล้างตัวกรอง → เดิม local state ยิง q กลับเข้า URL
  assert.equal(searchInputAfterUrlChange('', 'ก.ย. 11', 'ก.ย. 11'), '');
});

test('ช่องค้นหา: ลิงก์เปลี่ยนเดือน/Back → รับค่าจาก URL', () => {
  assert.equal(searchInputAfterUrlChange('', 'กาแฟ', 'กาแฟ'), '');
  assert.equal(searchInputAfterUrlChange('เก่า', 'กาแฟ', 'กาแฟ'), 'เก่า');
});

test('ช่องค้นหา: ค่า URL ตรงกับที่แสดงอยู่แล้ว → ไม่ต้อง set state ซ้ำ', () => {
  assert.equal(searchInputAfterUrlChange('กาแฟ', 'อื่น', 'กาแฟ'), null);
});

test('buildHref: ค่า undefined = ตัดคีย์นั้นออกจาก URL (ล้างคำค้น/หมวด)', () => {
  const href = buildHref('m=2026-09-01&q=%E0%B8%81&categoryId=abc', { q: undefined });
  const params = new URLSearchParams(href.split('?')[1]);
  assert.equal(params.get('q'), null);
  assert.equal(params.get('categoryId'), 'abc');
  assert.equal(params.get('m'), '2026-09-01');
});

test('buildHref: ล้างตัวกรองพร้อมกัน (q/kind/category/account) แล้วเหลือแค่ m', () => {
  const base = 'm=2026-09-01&kind=expense&categoryId=abc&accountId=def&q=zx';
  const href = buildHref(base, { kind: undefined, categoryId: undefined, accountId: undefined, q: undefined });
  assert.equal(href, '/transactions?m=2026-09-01');
});

test('buildHref: ตั้งค่าใหม่ทับของเดิม และคง m ไว้เสมอ', () => {
  const href = buildHref('m=2026-09-01&kind=expense', { kind: 'income' });
  const params = new URLSearchParams(href.split('?')[1]);
  assert.equal(params.get('kind'), 'income');
  assert.equal(params.get('m'), '2026-09-01');
});

test('buildHref: ตัด pages ทิ้งเสมอ (เปลี่ยนตัวกรอง = กลับหน้าแรก)', () => {
  for (const overrides of [{ q: 'ก' }, { kind: 'expense' }, { categoryId: undefined }]) {
    const href = buildHref('m=2026-09-01&pages=4&q=เก่า', overrides);
    assert.equal(new URLSearchParams(href.split('?')[1]).get('pages'), null);
  }
});

test('ว่าง: มีแถวอยู่ → ไม่ใช่สถานะว่าง', () => {
  assert.equal(
    emptyStateFor({ rowCount: 3, activeFilterCount: 0, hasAnyTransaction: true, isCurrentMonth: true }),
    null,
  );
});

test('ว่าง: มีตัวกรอง → "ไม่พบรายการ..." + ล้างตัวกรอง (แม้ผู้ใช้ยังไม่เคยมีรายการ)', () => {
  const state = emptyStateFor({ rowCount: 0, activeFilterCount: 1, hasAnyTransaction: false, isCurrentMonth: true });
  assert.deepEqual(state, { message: 'ไม่พบรายการที่ตรงกับตัวกรอง', action: 'clear-filters' });
});

test('ว่าง: ไม่มีข้อมูลเลย → "เริ่มบันทึกรายการแรก" + เปิด sheet', () => {
  const state = emptyStateFor({ rowCount: 0, activeFilterCount: 0, hasAnyTransaction: false, isCurrentMonth: true });
  assert.deepEqual(state, { message: 'เริ่มบันทึกรายการแรก', action: 'open-add' });
});

test('ว่าง: เดือนนี้ว่างแต่มีข้อมูลเดือนอื่น (วันที่ 1) → "เดือนนี้ยังไม่มีรายการ" + ไม่มีปุ่มชี้ที่เดิม', () => {
  const state = emptyStateFor({ rowCount: 0, activeFilterCount: 0, hasAnyTransaction: true, isCurrentMonth: true });
  assert.deepEqual(state, { message: 'เดือนนี้ยังไม่มีรายการ', action: 'none' });
});

test('ว่าง: ดูเดือนอื่นที่ว่าง (มีข้อมูลเดือนอื่น) → "เดือนนี้ยังไม่มีรายการ" + กลับเดือนนี้', () => {
  const state = emptyStateFor({ rowCount: 0, activeFilterCount: 0, hasAnyTransaction: true, isCurrentMonth: false });
  assert.deepEqual(state, { message: 'เดือนนี้ยังไม่มีรายการ', action: 'back-to-current' });
});
