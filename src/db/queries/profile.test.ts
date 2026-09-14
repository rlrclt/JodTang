/**
 * เทสต์การอ่านโปรไฟล์ผู้ใช้ (อีเมล + สถานะยืนยัน + ธงอีเมลตัวแทน) — PGlite apply DDL จาก docs/schema.sql
 * รัน: node --test src/db/queries/profile.test.ts
 *
 * กติกาที่คุมด้วยชุดนี้:
 *   1. `usesPlaceholderEmail` ต้องมาจาก "โดเมนตัวแทน" ที่ประกาศที่เดียว (src/lib/line-profile.ts) ไม่ใช่ hardcode ซ้ำ
 *   2. ผู้ใช้ที่ไม่มีแถว = null (ไม่ throw) — ผู้เรียกแยก "ยังไม่มีอีเมล" (แถวมี email null) ออกจาก "ไม่มีผู้ใช้" เองได้
 *   3. อ่านครั้งเดียว = 1 query เท่านั้น (หน้าโปรไฟล์ถูกเรียกบ่อย ห้ามยิงเพิ่มต่อผู้ใช้)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import { getUserProfile } from './profile.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const REAL = 'u-real';
const PLACEHOLDER = 'u-line';
const NO_EMAIL = 'u-none';

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`insert into "user" (id, name, email, email_verified) values
  ('${REAL}', 'มีอีเมลจริง', 'yoru@example.com', false),
  ('${PLACEHOLDER}', 'ล็อกอิน LINE', 'u4af4980629a1b2c3d4e5f60718293a4b@line.local', false),
  ('${NO_EMAIL}', 'ยังไม่ตั้งอีเมล', null, false),
  ('u-verified', 'ยืนยันแล้ว', 'verified@example.com', true);`);

const db = drizzle(pglite, { schema }) as unknown as Db;

/** นับ query ที่ drizzle ยิงจริง (ดักที่ client ของ PGlite) — ใช้พิสูจน์ "1 query" */
function countingClient() {
  let queries = 0;
  const client = new Proxy(pglite as unknown as Record<string, unknown>, {
    get(target, prop) {
      if (prop === 'query') {
        return (...args: unknown[]) => {
          queries += 1;
          return (Reflect.get(target, 'query') as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      return Reflect.get(target, prop);
    },
  }) as unknown as typeof pglite;
  return { db: drizzle(client, { schema }) as unknown as Db, count: () => queries };
}

test('อีเมลจริง → ค่าตรงจาก DB และไม่ใช่ตัวแทน', async () => {
  assert.deepEqual(await getUserProfile(db, REAL), {
    email: 'yoru@example.com',
    emailVerified: false,
    usesPlaceholderEmail: false,
  });
});

test('อีเมลตัวแทนของ LINE → usesPlaceholderEmail = true (โดเมนอ่านจากที่ประกาศเดียว)', async () => {
  const profile = await getUserProfile(db, PLACEHOLDER);
  assert.equal(profile?.email, 'u4af4980629a1b2c3d4e5f60718293a4b@line.local');
  assert.equal(profile?.usesPlaceholderEmail, true, 'ต้องรู้ว่าเป็นอีเมลที่ระบบสร้างให้ ไม่ใช่ของจริง');
  assert.equal(profile?.emailVerified, false);
});

test('ยังไม่มีอีเมล (null) → email = null แต่ยังได้แถว · ผู้ใช้ที่ยืนยันแล้วอ่านธงถูก', async () => {
  assert.deepEqual(await getUserProfile(db, NO_EMAIL), {
    email: null,
    emailVerified: false,
    usesPlaceholderEmail: false,
  });
  assert.deepEqual(await getUserProfile(db, 'u-verified'), {
    email: 'verified@example.com',
    emailVerified: true,
    usesPlaceholderEmail: false,
  });
});

test('userId ที่ไม่มีในระบบ → null (ไม่ throw)', async () => {
  assert.equal(await getUserProfile(db, 'u-ไม่มีอยู่'), null);
});

test('อ่านครั้งเดียว = 1 query', async () => {
  const { db: counting, count } = countingClient();
  await getUserProfile(counting, REAL);
  assert.equal(count(), 1, 'ต้องเป็น select เดียว ไม่ยิงตามตารางอื่น');
});
