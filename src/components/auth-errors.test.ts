import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTH_ERROR_FALLBACK, authErrorFor } from './auth-errors.ts';

test('authErrorFor: รหัสที่พบบ่อยได้ข้อความไทยที่บอกทางแก้', () => {
  assert.equal(authErrorFor('state_mismatch'), 'เซสชันการเข้าสู่ระบบหมดอายุหรือไม่ตรงกัน — เริ่มล็อกอินใหม่อีกครั้ง');
  assert.equal(authErrorFor('invalid_grant'), 'โค้ดยืนยันจากผู้ให้บริการใช้ไม่ได้หรือหมดอายุแล้ว — ลองล็อกอินใหม่อีกครั้ง');
  assert.equal(authErrorFor('access_denied'), 'การเข้าสู่ระบบถูกยกเลิกหรือถูกปฏิเสธ — ลองใหม่ได้เลย');
  assert.match(authErrorFor('email_not_found') ?? '', /อีเมล/);
  assert.match(authErrorFor('account_already_linked_to_different_user') ?? '', /ผูกกับผู้ใช้อื่น/);
});

test('authErrorFor: ไม่มีรหัส = ไม่ต้องแสดงอะไร (null)', () => {
  assert.equal(authErrorFor(undefined), null);
  assert.equal(authErrorFor(''), null);
  assert.equal(authErrorFor('   '), null);
  assert.equal(authErrorFor(null), null);
  assert.equal(authErrorFor(42), null);
});

test('authErrorFor: รหัสที่ไม่รู้จัก → ข้อความทั่วไป และ **ไม่ echo ค่าจาก query**', () => {
  assert.equal(authErrorFor('zzz_unknown_code'), AUTH_ERROR_FALLBACK);
  // ค่าที่เป็นอันตราย/มั่ว ต้องไม่หลุดลงหน้าเว็บแม้แต่ตัวอักษรเดียว (map เป็นข้อความคงที่เท่านั้น)
  const hostile = '<script>alert(1)</script>';
  const message = authErrorFor(hostile);
  assert.equal(message, AUTH_ERROR_FALLBACK);
  assert.ok(!message.includes('script'), 'ต้องไม่ echo ค่าที่ผู้ใช้ส่งมา');
  assert.ok(!message.includes(hostile));
});

test('authErrorFor: ข้อความที่แสดงไม่มีรหัสเทคนิค/ภาษาอังกฤษของ provider หลุด', () => {
  const codes = [
    'access_denied',
    'cancelled',
    'state_mismatch',
    'state_security_mismatch',
    'invalid_grant',
    'invalid_code',
    'no_code',
    'email_not_found',
    'email_not_verified',
    'email_does_not_match',
    'account_already_linked_to_different_user',
    'unable_to_get_user_info',
    'unable_to_link_account',
    'zzz_unknown',
  ];
  for (const code of codes) {
    const message = authErrorFor(code) ?? '';
    assert.ok(message.length > 0, code);
    assert.ok(!message.includes(code), `ข้อความของ ${code} ต้องไม่ echo รหัส`);
    assert.ok(!/[_a-z]{4,}/.test(message), `ข้อความของ ${code} ต้องไม่มีศัพท์อังกฤษ/รหัสเทคนิค: ${message}`);
  }
});
