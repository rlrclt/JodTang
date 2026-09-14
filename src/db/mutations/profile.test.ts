/**
 * เทสต์ write path ของ "ตั้ง/แก้อีเมลของตัวเอง" (setOwnEmail) — PGlite apply DDL จาก docs/schema.sql
 * รัน: node --test src/db/mutations/profile.test.ts
 *
 * กติกาที่คุมด้วยชุดนี้ (สเปก local://wave25-design.md §1/§3):
 *   - ตั้งเอง ⇒ email_verified = false เสมอ (เราไม่มีการยืนยันอีเมล) · verified = true (Google) = อ่านอย่างเดียว
 *   - normalize trim + lowercase ให้ผ่าน check ของ DB (`email = lower(btrim(email))`)
 *   - โดเมนสงวน (line.local/.local/.invalid/.test/.example/localhost) ตั้งเองไม่ได้
 *   - ชนคนอื่น = 23505 → ข้อความไทย ไม่ใช่ error ดิบ · ล้างค่าได้ (null หรือค่าว่าง) → กลับเป็น "ยังไม่มีอีเมล"
 *   - userId มาจาก session เท่านั้น และเขียนเป็น statement เดียว (atomic) → ไม่มีช่วงแข่งให้ verified พลิก
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { ValidationError } from '../errors.ts';
import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import { setOwnEmail } from './profile.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const LINE_USER = 'u-line';
const FRESH = 'u-fresh';
const TAKEN = 'u-taken';
const GOOGLE = 'u-google';

const SESSION_LINE: { userId: string } = { userId: LINE_USER };
const SESSION_GOOGLE: { userId: string } = { userId: GOOGLE };

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`insert into "user" (id, name, email, email_verified, updated_at) values
  ('${LINE_USER}', 'ล็อกอิน LINE', 'u4af4980629a1b2c3d4e5f60718293a4b@line.local', false, '2026-01-01T00:00:00Z'),
  ('${FRESH}', 'ยังไม่ตั้งอีเมล', null, false, '2026-01-01T00:00:00Z'),
  ('${TAKEN}', 'จองอีเมลไว้', 'taken@example.com', false, '2026-01-01T00:00:00Z'),
  ('${GOOGLE}', 'ล็อกอิน Google', 'verified@example.com', true, '2026-01-01T00:00:00Z');`);

/** เวลาตั้งต้นของทุกแถวใน fixture — ใช้พิสูจน์ว่า write path เขียน updated_at เองจริง (ไม่ใช่ค่าเดิมค้าง) */
const SEEDED_AT = new Date('2026-01-01T00:00:00Z');

const db = drizzle(pglite, { schema }) as unknown as Db;

type RawUser = { email: string | null; email_verified: boolean; updated_at: string };

const rawUser = async (id: string): Promise<RawUser> => {
  const result = await pglite.query<RawUser>(
    `select email, email_verified, updated_at from "user" where id = '${id}'`,
  );
  return result.rows[0];
};

/** นับ query ที่ drizzle ยิงจริง — ใช้พิสูจน์ว่าเส้นทางสำเร็จ = statement เดียว */
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

const why = (error: unknown) => {
  const parts: string[] = [];
  for (let node: unknown = error, depth = 0; node && depth < 5; depth++) {
    parts.push(String((node as { message?: unknown }).message ?? ''));
    node = (node as { cause?: unknown }).cause;
  }
  return parts.join(' · ');
};

test('ตั้งอีเมลใหม่: trim + lowercase, verified = false, updated_at ถูกเขียนเอง (ไม่มี trigger)', async () => {
  const saved = await setOwnEmail(db, { userId: FRESH }, { email: '  Me@Example.COM  ' });
  assert.deepEqual(saved, { email: 'me@example.com', emailVerified: false });

  const after = await rawUser(FRESH);
  assert.equal(after.email, 'me@example.com', 'DB เก็บตัวพิมพ์เล็กและตัดช่องว่าง (ผ่าน check ของ DB)');
  assert.equal(after.email_verified, false, 'ตั้งเอง = ยังไม่ยืนยันเสมอ');
  assert.ok(
    new Date(after.updated_at) > SEEDED_AT,
    'updated_at ต้องถูกเขียนใน UPDATE นี้เอง (ตาราง user ไม่มี trigger — docs/schema.sql:286-287)',
  );
});

test('แก้ทับของเดิมได้ (ยังไม่ยืนยัน) · ตั้งค่าเดิมซ้ำของตัวเองก็ผ่าน (ไม่ชน unique ของตัวเอง)', async () => {
  assert.deepEqual(await setOwnEmail(db, { userId: FRESH }, { email: 'new@example.com' }), {
    email: 'new@example.com',
    emailVerified: false,
  });
  assert.equal((await rawUser(FRESH)).email, 'new@example.com');

  // ค่าเดิมของตัวเอง → UPDATE แถวเดิมจึงไม่ชน unique
  assert.deepEqual(await setOwnEmail(db, { userId: FRESH }, { email: 'new@example.com' }), {
    email: 'new@example.com',
    emailVerified: false,
  });
  assert.equal((await rawUser(FRESH)).email, 'new@example.com');
});

test('ล้างอีเมล: null หรือค่าว่าง = ตั้งใจลบ → กลับเป็น "ยังไม่มีอีเมล"', async () => {
  assert.deepEqual(await setOwnEmail(db, { userId: FRESH }, { email: null }), {
    email: null,
    emailVerified: false,
  });
  assert.equal((await rawUser(FRESH)).email, null);

  await setOwnEmail(db, { userId: FRESH }, { email: 'back@example.com' });
  assert.deepEqual(await setOwnEmail(db, { userId: FRESH }, { email: '   ' }), {
    email: null,
    emailVerified: false,
  });
  assert.equal((await rawUser(FRESH)).email, null, 'ช่องว่างล้วน = ล้างค่า ไม่ใช่รูปแบบผิด');
});

test('ไม่ได้ส่งฟิลด์ email มา = คนละเรื่องกับ "ล้างค่า" → ValidationError และไม่แตะ DB', async () => {
  const before = await rawUser(FRESH);
  for (const input of [{}, undefined, null, 42, { email: undefined }, 'me@example.com']) {
    await assert.rejects(
      () => setOwnEmail(db, { userId: FRESH }, input),
      (error: unknown) => error instanceof ValidationError && /อีเมล/.test(error.message),
      `ต้องปฏิเสธ input: ${JSON.stringify(input)}`,
    );
  }
  assert.deepEqual(await rawUser(FRESH), before);
});

test('รูปแบบผิด/ยาวเกิน/โดเมนสงวน → ValidationError ไทย และไม่มีอะไรเปลี่ยนใน DB', async () => {
  const before = await rawUser(FRESH);
  const bad: { email: unknown; expect: RegExp; why: string }[] = [
    { email: 'ไม่มี at', expect: /รูปแบบอีเมลไม่ถูกต้อง/, why: 'ไม่มี @' },
    { email: 'me@exmple', expect: /รูปแบบอีเมลไม่ถูกต้อง/, why: 'โดเมนไม่มีจุด (และไม่ใช่โดเมนสงวน)' },
    { email: 'me@@example.com', expect: /รูปแบบอีเมลไม่ถูกต้อง/, why: '@ สองตัว' },
    { email: 'me@exa mple.com', expect: /รูปแบบอีเมลไม่ถูกต้อง/, why: 'มีช่องว่างกลาง' },
    { email: `${'a'.repeat(290)}@example.com`, expect: /6–254/, why: 'ยาว 302 ตัว' },
    { email: 'a@line.local', expect: /โดเมนอีเมลจริง/, why: 'โดเมนตัวแทนของเรา' },
    { email: 'b@sub.line.local', expect: /โดเมนอีเมลจริง/, why: 'ซับโดเมนของโดเมนตัวแทน' },
    { email: 'c@foo.local', expect: /โดเมนอีเมลจริง/, why: '.local' },
    { email: 'd@foo.invalid', expect: /โดเมนอีเมลจริง/, why: '.invalid' },
    { email: 'e@foo.test', expect: /โดเมนอีเมลจริง/, why: '.test' },
    { email: 'f@foo.example', expect: /โดเมนอีเมลจริง/, why: '.example' },
    { email: 'h@example', expect: /โดเมนอีเมลจริง/, why: 'โดเมนสงวนล้วน ๆ (ไม่มีจุด) — สาเหตุจริงคือโดเมนสงวน' },
    { email: 'g@localhost', expect: /โดเมนอีเมลจริง/, why: 'localhost' },
    { email: 42, expect: /อีเมล/, why: 'ไม่ใช่ข้อความ' },
  ];
  for (const { email, expect, why: label } of bad) {
    await assert.rejects(
      () => setOwnEmail(db, { userId: FRESH }, { email }),
      (error: unknown) => error instanceof ValidationError && expect.test(error.message) && !/SQL|select |update /i.test(error.message),
      `ต้องปฏิเสธ: ${label}`,
    );
  }
  assert.deepEqual(await rawUser(FRESH), before, 'input ผิดต้องไม่แตะ DB');
  assert.equal((await rawUser(LINE_USER)).email, 'u4af4980629a1b2c3d4e5f60718293a4b@line.local');
});

test('ชนกับบัญชีอื่น (unique user_email_key) → ข้อความไทย ไม่ใช่ error ดิบ และไม่มีแถวไหนถูกแก้', async () => {
  const mineBefore = await rawUser(FRESH);
  const theirsBefore = await rawUser(TAKEN);

  await assert.rejects(
    () => setOwnEmail(db, { userId: FRESH }, { email: 'TAKEN@example.com ' }),
    (error: unknown) =>
      error instanceof ValidationError &&
      error.message === 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว — ลองอีเมลอื่น' &&
      /user_email_key/.test(why(error)),
  );

  assert.deepEqual(await rawUser(FRESH), mineBefore, 'ของเราต้องไม่ถูกแก้');
  assert.deepEqual(await rawUser(TAKEN), theirsBefore, 'ของเจ้าของเดิมต้องไม่ถูกแตะ');
});

test('ผู้ใช้ที่ยืนยันแล้ว (Google) ตั้งเองไม่ได้ — อ่านอย่างเดียว และแถวเดิมไม่ถูกแตะ', async () => {
  const before = await rawUser(GOOGLE);
  await assert.rejects(
    () => setOwnEmail(db, SESSION_GOOGLE, { email: 'mine@example.com' }),
    (error: unknown) => error instanceof ValidationError && /ยืนยันแล้ว/.test(error.message),
  );
  await assert.rejects(
    () => setOwnEmail(db, SESSION_GOOGLE, { email: null }),
    (error: unknown) => error instanceof ValidationError && /ยืนยันแล้ว/.test(error.message),
    'ล้างค่าก็ต้องไม่ทำให้สถานะยืนยันหาย',
  );
  assert.deepEqual(await rawUser(GOOGLE), before, 'email/email_verified ต้องคงเดิม (verified = true ห้ามกลายเป็น false)');
});

test('session ของใคร = เขียนของคนนั้น · userId/ฟิลด์แปลกปลอมจาก input ใช้ไม่ได้', async () => {
  const lineBefore = await rawUser(LINE_USER);

  await setOwnEmail(db, { userId: TAKEN }, { email: 'taken2@example.com' });
  assert.equal((await rawUser(TAKEN)).email, 'taken2@example.com');
  assert.deepEqual(await rawUser(LINE_USER), lineBefore, 'แถวของคนอื่นต้องไม่ถูกแตะ');

  for (const input of [
    { email: 'sneaky@example.com', userId: GOOGLE },
    { email: 'sneaky@example.com', emailVerified: true },
    { email: 'sneaky@example.com', id: GOOGLE },
  ]) {
    await assert.rejects(
      () => setOwnEmail(db, SESSION_LINE, input),
      (error: unknown) =>
        error instanceof ValidationError && error.message === 'ไม่อนุญาตให้ส่งข้อมูลที่ไม่รองรับมา',
      `ต้องปฏิเสธฟิลด์แปลกปลอม: ${Object.keys(input).join(',')}`,
    );
  }
  assert.deepEqual(await rawUser(LINE_USER), lineBefore);

  // session ของผู้ใช้ที่ไม่อยู่ในระบบแล้ว → ข้อความไทย ไม่ใช่ TypeError/อัปเดตเงียบ
  await assert.rejects(
    () => setOwnEmail(db, { userId: 'u-ถูกลบไปแล้ว' }, { email: 'ghost@example.com' }),
    (error: unknown) => error instanceof ValidationError && /ไม่พบผู้ใช้/.test(error.message),
  );
});

test('เส้นทางสำเร็จ = statement เดียว (atomic: ไม่มีช่วงให้ verified พลิกกลางทาง)', async () => {
  const { db: counting, count } = countingClient();
  await setOwnEmail(counting, { userId: FRESH }, { email: 'one@example.com' });
  assert.equal(count(), 1, 'ต้องเป็น update เดียว (ไม่มี select นำหน้า)');

  // และแถวเดียวนี้ทั้งตัดสินสิทธิ์และกัน unique → verified พลิกก่อนยิงไม่ได้ทำให้ verified หาย
  const before = await rawUser(GOOGLE);
  const { db: counting2, count: count2 } = countingClient();
  await assert.rejects(() => setOwnEmail(counting2, SESSION_GOOGLE, { email: 'x@example.com' }), ValidationError);
  assert.equal(count2(), 2, 'เส้นที่แพ้ยิงเพิ่ม 1 query เพื่อแยกสาเหตุ (verified vs ไม่มีผู้ใช้)');
  assert.deepEqual(await rawUser(GOOGLE), before);
});
