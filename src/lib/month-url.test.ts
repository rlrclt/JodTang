import assert from 'node:assert/strict';
import test from 'node:test';

import { periodMonthOfBkk } from './month.ts';
import { monthScopeFromParam, withMonth } from './month-url.ts';

test('monthScopeFromParam: เก็บ all ไว้ ไม่ยุบเป็นเดือนปัจจุบัน', () => {
  assert.equal(monthScopeFromParam('all'), 'all');
});

test('monthScopeFromParam: ค่าขยะทุกแบบตกกลับเดือนปัจจุบัน (ไม่ 500)', () => {
  const current = periodMonthOfBkk();
  for (const value of ['', 'al', 'ALL', '2026-13-01', '2026-09-15', null, undefined, ['all']]) {
    assert.equal(monthScopeFromParam(value), current, JSON.stringify(value));
  }
});

test('monthScopeFromParam: เดือนจริงผ่านมาตรง ๆ', () => {
  assert.equal(monthScopeFromParam('2026-08-01'), '2026-08-01');
});

test('withMonth: เขียน m เป็น all ได้ และคง query เดิมไว้', () => {
  assert.equal(withMonth('/transactions?q=ข้าว', 'all'), '/transactions?q=%E0%B8%82%E0%B9%89%E0%B8%B2%E0%B8%A7&m=all');
  assert.equal(withMonth('/transactions?m=2026-08-01&q=x', 'all'), '/transactions?m=all&q=x');
  assert.equal(withMonth('/transactions?m=all', '2026-09-01'), '/transactions?m=2026-09-01');
});

test('withMonth: extra เติม/ลบได้ และเขียน m ทับของเดิมเสมอ', () => {
  assert.equal(withMonth('/transactions?m=all', 'all', { pages: 2 }), '/transactions?m=all&pages=2');
  assert.equal(withMonth('/transactions?m=all&pages=3', 'all', { pages: undefined }), '/transactions?m=all');
});
