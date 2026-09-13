/**
 * เทสต์การคิด "เดือนไทย" — ที่เดียวของทั้งแอป (Asia/Bangkok ไม่ใช่ UTC และไม่ใช่เวลาท้องถิ่นของเครื่อง)
 * รัน: node --test src/lib/month.test.ts
 *
 * ทำไมต้องมี: ถ้าตัดเดือนด้วย UTC ตัวเลข "ยอดเดือนนี้" จะเพี้ยนทุกคืนสุดท้ายของเดือน
 * (ผู้ใช้บันทึก 23:30 น. วันที่ 31 ส.ค. แต่ยอดไปโผล่เดือน ก.ย.)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatMonthLabelTh,
  periodMonthFromParam,
  periodMonthOfBkk,
  shiftPeriodMonth,
} from './month.ts';

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

test('shiftPeriodMonth เลื่อนเดือนด้วยการคำนวณสตริงล้วน (ข้ามปีทั้งสองทาง)', () => {
  assert.equal(shiftPeriodMonth('2026-09-01', 0), '2026-09-01');
  assert.equal(shiftPeriodMonth('2026-09-01', 1), '2026-10-01');
  assert.equal(shiftPeriodMonth('2026-09-01', -1), '2026-08-01');
  assert.equal(shiftPeriodMonth('2026-01-01', -1), '2025-12-01');
  assert.equal(shiftPeriodMonth('2026-12-01', 1), '2027-01-01');
  assert.equal(shiftPeriodMonth('2026-09-01', -12), '2025-09-01');
  assert.equal(shiftPeriodMonth('2026-09-01', 12), '2027-09-01');
  assert.equal(shiftPeriodMonth('2026-03-01', -5), '2025-10-01');
});

test('shiftPeriodMonth ปฏิเสธงวดเดือนที่ผิดรูป และจำนวนเดือนที่ไม่ใช่จำนวนเต็ม', () => {
  for (const bad of ['2026-09-15', '2026-13-01', 'กันยายน', '']) {
    assert.throws(() => shiftPeriodMonth(bad, 1), TypeError, `ต้องปฏิเสธ: ${bad}`);
  }
  assert.throws(() => shiftPeriodMonth('2026-09-01', 1.5), TypeError);
});

test('periodMonthFromParam: ค่าดิบจาก ?m= ต้องไม่ throw และค่าขยะตกกลับเดือนปัจจุบัน', () => {
  const current = periodMonthOfBkk();

  assert.equal(periodMonthFromParam('2026-08-01'), '2026-08-01', 'ค่าที่ถูกต้องต้องใช้ตามนั้น (ไม่ใช่เดือนปัจจุบัน)');
  assert.equal(periodMonthFromParam('2026-01-01'), '2026-01-01');

  // ทั้งหมดนี้ผู้ใช้พิมพ์มาได้จริง → ต้องได้เดือนปัจจุบัน ไม่ใช่ 500
  for (const junk of ['abc', '', '2026-13-01', '2026-00-01', '2026-09-15', '2026-02-31', '2026-09', 'กันยายน', null, undefined, 42, ['2026-09-01']]) {
    assert.equal(periodMonthFromParam(junk), current, `ต้องตกกลับเดือนปัจจุบัน: ${JSON.stringify(junk)}`);
  }
  assert.match(current, /^\d{4}-(0[1-9]|1[0-2])-01$/);
});

test('shiftPeriodMonth ที่ขอบช่วงปีต้องหยุดที่ขอบ ไม่คืนสตริงผิดรูป', () => {
  // ปี ≤ 0 หรือ ≥ 10000 จะประกอบเป็น '00-1-…'/'10000-01-01' → PG ปฏิเสธ date param (หน้าพัง 500)
  assert.equal(shiftPeriodMonth('9999-12-01', 1), '9999-12-01', 'เลยขอบบน = หยุดที่ขอบ');
  assert.equal(shiftPeriodMonth('1000-01-01', -1), '1000-01-01', 'เลยขอบล่าง = หยุดที่ขอบ');
  assert.equal(shiftPeriodMonth('9999-12-01', 1_000_000), '9999-12-01', 'ห่างไกลขนาดไหนก็ยังเป็นสตริงที่ถูกต้อง');
  assert.equal(shiftPeriodMonth('1000-01-01', -1_000_000), '1000-01-01');

  // ทุกค่าที่คืนต้องมีรูปแบบเทียบ equality กับ occurred_month_bkk ได้เสมอ
  for (const months of [-13, -1, 0, 1, 13, 999]) {
    assert.match(shiftPeriodMonth('9999-06-01', months), /^\d{4}-(0[1-9]|1[0-2])-01$/);
    assert.match(shiftPeriodMonth('1000-06-01', months), /^\d{4}-(0[1-9]|1[0-2])-01$/);
  }
});

test('periodMonthFromParam ปฏิเสธปีนอกช่วง (0000/10000) → ตกกลับเดือนปัจจุบัน ไม่หลุดไปถึง query', () => {
  const current = periodMonthOfBkk();

  // เคสจากรีวิว: ?m=0000-01-01 เดิมหลุดไปถึง trendByMonth → PG error
  assert.equal(periodMonthFromParam('0000-01-01'), current);
  assert.equal(periodMonthFromParam('10000-01-01'), current);
  assert.equal(periodMonthFromParam('0999-12-01'), current);
  // ปีสุดขอบที่ยังรับได้ ต้องไม่ถูกปรับ (แล้ว trend 6 งวดก็ยังอยู่ในช่วง)
  assert.equal(periodMonthFromParam('9999-12-01'), '9999-12-01');
  assert.equal(periodMonthFromParam('1000-01-01'), '1000-01-01');
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
