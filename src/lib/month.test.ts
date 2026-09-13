/**
 * เทสต์การคิด "เดือนไทย" — ที่เดียวของทั้งแอป (Asia/Bangkok ไม่ใช่ UTC และไม่ใช่เวลาท้องถิ่นของเครื่อง)
 * รัน: node --test src/lib/month.test.ts
 *
 * ทำไมต้องมี: ถ้าตัดเดือนด้วย UTC ตัวเลข "ยอดเดือนนี้" จะเพี้ยนทุกคืนสุดท้ายของเดือน
 * (ผู้ใช้บันทึก 23:30 น. วันที่ 31 ส.ค. แต่ยอดไปโผล่เดือน ก.ย.)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { formatMonthLabelTh, periodMonthOfBkk } from './month.ts';

test('periodMonthOfBkk ตัดเดือนตามเวลาไทย (+07) ไม่ใช่ UTC', () => {
  // 2026-08-31 16:59Z = 23:59 ไทย → ยังเป็นเดือน ส.ค.
  assert.equal(periodMonthOfBkk(new Date('2026-08-31T16:59:00Z')), '2026-08-01');
  // 2026-08-31 17:00Z = 00:00 ไทย 1 ก.ย. → ขึ้นเดือนใหม่
  assert.equal(periodMonthOfBkk(new Date('2026-08-31T17:00:00Z')), '2026-09-01');
});

test('periodMonthOfBkk ข้ามปีที่ขอบเดือน ธ.ค. → ม.ค.', () => {
  assert.equal(periodMonthOfBkk(new Date('2026-12-31T16:59:00Z')), '2026-12-01');
  assert.equal(periodMonthOfBkk(new Date('2026-12-31T17:00:00Z')), '2027-01-01');
});

test('periodMonthOfBkk ไม่ส่ง argument = เดือนปัจจุบัน และลงท้ายด้วย -01 เสมอ', () => {
  const month = periodMonthOfBkk();
  assert.match(month, /^\d{4}-(0[1-9]|1[0-2])-01$/);
  assert.equal(month, periodMonthOfBkk(new Date()));
});

test('formatMonthLabelTh ใช้ปีพุทธศักราช (ตรงกับ MONTH_LABEL ที่ UI ใช้)', () => {
  assert.equal(formatMonthLabelTh('2026-09-01'), 'กันยายน 2569');
  assert.equal(formatMonthLabelTh('2027-01-01'), 'มกราคม 2570');
});

test('formatMonthLabelTh ปฏิเสธสตริงที่ไม่ใช่วันแรกของเดือน', () => {
  for (const bad of ['2026-09-15', '2026-9-01', '2026-13-01', '2026-00-01', '', 'กันยายน 2569']) {
    assert.throws(() => formatMonthLabelTh(bad), TypeError, `ต้องปฏิเสธ: ${bad}`);
  }
});
