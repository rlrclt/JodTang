/**
 * เทสต์ store ของช่องประกาศ — รัน: node --test src/components/announce-store.test.ts
 * เคสสำคัญ: ข้อความต้อง "อยู่" จนครบ TTL (บั๊กเดิม: ประกาศถูกถอดใน ~39ms เพราะอยู่ในส่วนที่ RSC refresh แทนที่)
 * ใช้ mock timer ของ node:test — เวลาเดินแบบกำหนดได้ ไม่หน่วงจริง
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { announce, currentAnnouncement, subscribe } from './announce-store.ts';

test('ประกาศแล้วข้อความอยู่จนครบ TTL แล้วล้างเอง', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  announce('สร้างกระเป๋าเงินสด + 5 หมวดแล้ว', 300);
  assert.equal(currentAnnouncement(), 'สร้างกระเป๋าเงินสด + 5 หมวดแล้ว');

  t.mock.timers.tick(150);
  assert.equal(currentAnnouncement(), 'สร้างกระเป๋าเงินสด + 5 หมวดแล้ว', 'ต้องยังอยู่ระหว่าง TTL');

  t.mock.timers.tick(200);
  assert.equal(currentAnnouncement(), '', 'ต้องล้างหลัง TTL');
});

test('ผู้สมัครรับข้อความได้ทั้งข้อความใหม่และการล้าง', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const seen: string[] = [];
  const unsubscribe = subscribe((message) => seen.push(message));

  announce('ก', 120);
  t.mock.timers.tick(200);
  unsubscribe();

  assert.deepEqual(seen, ['ก', '']);
});

test('ประกาศซ้ำ: ข้อความใหม่แทนของเดิม และเวลาล้างนับจากครั้งล่าสุด', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  announce('หนึ่ง', 200);
  t.mock.timers.tick(120);
  announce('สอง', 200);

  t.mock.timers.tick(120);
  assert.equal(currentAnnouncement(), 'สอง', 'ยังไม่ครบ TTL ของครั้งล่าสุด');

  t.mock.timers.tick(150);
  assert.equal(currentAnnouncement(), '');
});

test('เลิกสมัครแล้วไม่ได้รับข้อความอีก', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const seen: string[] = [];
  const unsubscribe = subscribe((message) => seen.push(message));
  unsubscribe();

  announce('ไม่ควรถึง', 50);
  t.mock.timers.tick(80);

  assert.deepEqual(seen, []);
});
