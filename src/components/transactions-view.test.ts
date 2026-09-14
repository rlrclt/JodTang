/**
 * เทสต์ตรรกะบริสุทธิ์ของหน้ารายการ — รัน: node --test src/components/transactions-view.test.ts
 * ครอบบั๊ก 2 ตัวของ wave 8: URL ของ "ล้างตัวกรอง" และเกณฑ์แยกสถานะว่าง (spec §3)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SEARCH_MAX_LENGTH, allMonthsRangeLabel, buildHref, emptyStateFor, searchInputAfterUrlChange } from './transactions-view.ts';

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
  assert.deepEqual(state, { message: 'ไม่พบรายการที่ตรงกับตัวกรอง', action: 'clear-filters', offerAllMonths: true });
});

test('ว่าง: ไม่มีข้อมูลเลย → "เริ่มบันทึกรายการแรก" + เปิด sheet', () => {
  const state = emptyStateFor({ rowCount: 0, activeFilterCount: 0, hasAnyTransaction: false, isCurrentMonth: true });
  assert.deepEqual(state, { message: 'เริ่มบันทึกรายการแรก', action: 'open-add', offerAllMonths: false });
});

test('ว่าง: เดือนนี้ว่างแต่มีข้อมูลเดือนอื่น (วันที่ 1) → "เดือนนี้ยังไม่มีรายการ" + ไม่มีปุ่มชี้ที่เดิม', () => {
  const state = emptyStateFor({ rowCount: 0, activeFilterCount: 0, hasAnyTransaction: true, isCurrentMonth: true });
  assert.deepEqual(state, { message: 'เดือนนี้ยังไม่มีรายการ', action: 'none', offerAllMonths: false });
});

test('ว่าง: ดูเดือนอื่นที่ว่าง (มีข้อมูลเดือนอื่น) → "เดือนนี้ยังไม่มีรายการ" + กลับเดือนนี้', () => {
  const state = emptyStateFor({ rowCount: 0, activeFilterCount: 0, hasAnyTransaction: true, isCurrentMonth: false });
  assert.deepEqual(state, { message: 'เดือนนี้ยังไม่มีรายการ', action: 'back-to-current', offerAllMonths: false });
});

test('เพดานคำค้นของ UI ต้องเท่ากับเพดานที่ชั้นข้อมูลใช้ตัด', async () => {
  // ชั้นข้อมูลตัดคำค้นที่ 200 แบบเงียบ ๆ — ถ้า UI ยอมให้พิมพ์ยาวกว่านั้น ผู้ใช้จะถูกตัดโดยไม่รู้ตัว
  // (เทสต์นี้คือตัวกันไม่ให้ค่าสองฝั่งเพี้ยนกันในอนาคต โดยไม่ต้องให้ client import โมดูล DB)
  const { MAX_SEARCH_LENGTH } = await import('../db/queries/transactions.ts');
  assert.equal(SEARCH_MAX_LENGTH, MAX_SEARCH_LENGTH);
});

// --- wave19: โหมด "ทุกเดือน" ---
test('ว่างในโหมดทุกเดือน: เสนอ "ค้นหาทุกเดือน" ไม่ใช่ (อยู่ใน all แล้ว) และไม่มีคำว่า "เดือนนี้"', () => {
  const state = emptyStateFor({ rowCount: 0, activeFilterCount: 1, hasAnyTransaction: true, isCurrentMonth: false, isAllMonths: true });
  assert.deepEqual(state, { message: 'ไม่พบรายการที่ตรงกับตัวกรอง', action: 'clear-filters', offerAllMonths: false });

  // กันข้อความ "เดือนนี้" หลุดในโหมด all แม้เข้าเคส "ว่างแต่มีข้อมูลเดือนอื่น"
  const edge = emptyStateFor({ rowCount: 0, activeFilterCount: 0, hasAnyTransaction: true, isCurrentMonth: false, isAllMonths: true });
  assert.ok(edge && !edge.message.includes('เดือนนี้'), JSON.stringify(edge));
});

test('ป้ายช่วงเวลาโหมดทุกเดือน: เก่าสุด→ใหม่สุด + จำนวน + เตือนเมื่อถึงเพดาน', () => {
  const rows = [
    new Date('2026-09-14T01:00:00Z'), // แถวแรก = ใหม่สุด (ลิสต์เรียงใหม่→เก่า)
    new Date('2026-09-02T01:00:00Z'),
    new Date('2026-08-20T01:00:00Z'), // แถวสุดท้าย = เก่าสุด
  ];
  assert.equal(allMonthsRangeLabel(rows, false), 'ทุกเดือน · ตั้งแต่ สิงหาคม 2569 ถึง กันยายน 2569 · 3 รายการ');
  // ยังโหลดต่อได้ → บอกให้กด "โหลดเพิ่ม" (ไม่สั่งให้ลดช่วง ทั้งที่ปุ่มยังอยู่)
  assert.equal(
    allMonthsRangeLabel(rows, true),
    'ทุกเดือน · ตั้งแต่ สิงหาคม 2569 ถึง กันยายน 2569 · 3 รายการ · ยังมีอีก — กด "โหลดเพิ่ม" ด้านล่าง',
  );
  // ถึงเพดานหน้าแล้ว → ค่อยบอกให้ลดช่วงด้วยตัวกรอง
  assert.equal(
    allMonthsRangeLabel(rows, true, true),
    'ทุกเดือน · ตั้งแต่ สิงหาคม 2569 ถึง กันยายน 2569 · 3 รายการ · ยังมีอีก — ลดช่วงด้วยตัวกรอง',
  );
  assert.equal(allMonthsRangeLabel([new Date('2026-09-14T01:00:00Z'), new Date('2026-09-01T01:00:00Z')], false), 'ทุกเดือน · กันยายน 2569 · 2 รายการ');
  assert.equal(allMonthsRangeLabel([], false), '');
});
