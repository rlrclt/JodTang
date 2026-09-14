import assert from 'node:assert/strict';
import test from 'node:test';

import { emailDisplay } from './email-view.ts';

test('อีเมลตัวแทน (@line.local) → "ยังไม่ได้ตั้งอีเมล" และไม่โชว์ค่าดิบ', () => {
  const state = emailDisplay({ email: 'Uabc123@line.local', emailVerified: false, usesPlaceholderEmail: true });
  assert.equal(state.label, 'ยังไม่ได้ตั้งอีเมล');
  assert.ok(!state.label.includes('line.local'), 'ห้ามโชว์ที่อยู่ภายในระบบ');
  assert.equal(state.badge, null);
  assert.equal(state.canEdit, true);
  assert.equal(state.buttonLabel, 'ตั้งอีเมล');
  assert.equal(state.fieldValue, '');
});

test('ยังไม่มีอีเมลเลย → ตั้งได้', () => {
  const state = emailDisplay({ email: null, emailVerified: false, usesPlaceholderEmail: false });
  assert.equal(state.label, 'ยังไม่ได้ตั้งอีเมล');
  assert.equal(state.buttonLabel, 'ตั้งอีเมล');
  assert.equal(state.badge, null);
});

test('อีเมลที่ผู้ใช้ตั้งเอง (ยังไม่ยืนยัน) → โชว์อีเมล + ป้ายยังไม่ยืนยัน + แก้ได้', () => {
  const state = emailDisplay({ email: 'me@example.com', emailVerified: false, usesPlaceholderEmail: false });
  assert.equal(state.label, 'me@example.com');
  assert.equal(state.badge, 'unverified');
  assert.equal(state.canEdit, true);
  assert.equal(state.buttonLabel, 'แก้ไข');
  assert.equal(state.fieldValue, 'me@example.com');
});

test('ยืนยันแล้ว (Google) → ป้ายยืนยันแล้ว และ **ไม่มีปุ่มแก้**', () => {
  const state = emailDisplay({ email: 'me@gmail.com', emailVerified: true, usesPlaceholderEmail: false });
  assert.equal(state.label, 'me@gmail.com');
  assert.equal(state.badge, 'verified');
  assert.equal(state.canEdit, false);
  assert.equal(state.buttonLabel, null);
});

test('ยืนยันแล้วแต่ไม่มีอีเมลจริง → อ่านอย่างเดียว ไม่มีปุ่ม (ไม่แต่งสถานะขึ้นเอง)', () => {
  const state = emailDisplay({ email: 'Ux@line.local', emailVerified: true, usesPlaceholderEmail: true });
  assert.ok(!state.label.includes('line.local'));
  assert.equal(state.badge, null);
  assert.equal(state.canEdit, false);
  assert.equal(state.buttonLabel, null);
});
