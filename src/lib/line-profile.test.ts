/**
 * เทสต์การแปลงโปรไฟล์ LINE → ผู้ใช้ (กติกาใน src/lib/line-profile.ts)
 * รัน: node --test src/lib/line-profile.test.ts
 *
 * เคสที่ต้องผ่าน (ตามรีวิว wave23): มีอีเมล · ไม่มีอีเมล (ได้ตัวแทน) · sub เดิมต้องได้อีเมลเดิมเสมอ
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { mapLineProfileToUser } from './line-profile.ts';

test('มีอีเมลจริง → ใช้ตามนั้น (ไม่ถูกแทนด้วยตัวแทน) และ emailVerified = false', () => {
  const mapped = mapLineProfileToUser({ sub: 'U4af4980629', name: 'สตับ ผู้ใช้', email: 'Real@Example.COM' });

  assert.equal(mapped.email, 'real@example.com', 'normalize เป็น lower/trim ให้ผ่าน check ของ DB');
  assert.equal(mapped.name, 'สตับ ผู้ใช้', 'ชื่อมาจากโปรไฟล์');
  assert.equal(mapped.emailVerified, false, 'LINE ไม่ยืนยันอีเมล → false เสมอ');
});

test('ไม่มีอีเมล → ใช้ตัวแทน <sub>@line.local (lowercase) และ emailVerified = false', () => {
  const mapped = mapLineProfileToUser({ sub: 'U4af4980629A1B2C3', name: 'สตับ ผู้ใช้' });

  assert.equal(mapped.email, 'u4af4980629a1b2c3@line.local');
  assert.equal(mapped.emailVerified, false);
  // ต้องผ่าน check ของ DB: email = lower(btrim(email))
  assert.equal(mapped.email, mapped.email.toLowerCase().trim());
  assert.ok(mapped.email.endsWith('@line.local'), 'โดเมนสงวนสำหรับ mDNS — ไม่มีทางชนอีเมลจริง');
});

test('sub เดิมได้อีเมลเดิมเสมอ (เสถียร) · sub ต่างกันได้อีเมลต่างกัน (ไม่ชนกันเอง)', () => {
  const first = mapLineProfileToUser({ sub: 'Uabcdef01', name: 'A' });
  const again = mapLineProfileToUser({ sub: 'Uabcdef01', name: 'A ชื่อใหม่', email: '' });
  const other = mapLineProfileToUser({ sub: 'Uabcdef02', name: 'B' });

  assert.equal(first.email, again.email, 'ผู้ใช้คนเดิมล็อกอินซ้ำต้องได้อีเมลเดิม (ไม่สร้างบัญชีซ้ำ)');
  assert.notEqual(first.email, other.email, 'คนละ sub ต้องคนละอีเมล');
});

test('โปรไฟล์ที่ใช้ไม่ได้ → ล้มเสียงดัง (ไม่สร้างผู้ใช้ที่อีเมลซ้ำ/ปนกัน)', () => {
  assert.throws(() => mapLineProfileToUser({ name: 'ไม่มี sub' }), /ไม่มี sub/);
  assert.throws(() => mapLineProfileToUser(null), /ต้องเป็น object/);
  assert.throws(() => mapLineProfileToUser('nope'), /ต้องเป็น object/);
});

test('fallback ของชื่อ: displayName แทน name · ไม่มีทั้งคู่ = "ผู้ใช้ LINE"', () => {
  assert.equal(mapLineProfileToUser({ sub: 'U1', displayName: 'ชื่อ LINE' }).name, 'ชื่อ LINE');
  assert.equal(mapLineProfileToUser({ sub: 'U2' }).name, 'ผู้ใช้ LINE');
  assert.equal(mapLineProfileToUser({ sub: 'U3', name: '   ' }).name, 'ผู้ใช้ LINE');
});
