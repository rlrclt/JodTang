/**
 * Write path ของ "อีเมลของตัวเอง" (โปรไฟล์) — ตั้ง/แก้/ล้างอีเมล
 *
 * กติกาที่เลือก (สเปก local://wave25-design.md §1/§3 — อย่าแก้โดยไม่อ่าน):
 *   1. **ตั้งเอง ⇒ `email_verified = false` เสมอ** — เราไม่มี flow ส่งอีเมลยืนยันเลย จึงยืนยันให้ใครไม่ได้
 *      (UI ต้องมีคำว่า "ยังไม่ยืนยัน" ไม่ใช่ใช้สีอย่างเดียว)
 *   2. **`email_verified = true` แก้ไม่ได้** (อีเมลจาก Google) — ถ้าอนุญาต ต้องลด verified เป็น false
 *      = ผู้ใช้พิมพ์ผิดครั้งเดียวก็เสียสถานะยืนยันโดยไม่ได้อะไรกลับมา · ทางแก้คือไปแก้ที่ผู้ให้บริการแล้วล็อกอินใหม่
 *      ⇒ เส้นทางนี้ไม่แตะแถวที่ verified แล้วเลย (WHERE บังคับ email_verified = false)
 *   3. **ไม่เกี่ยวกับการล็อกอิน** — v1 ไม่มีล็อกอินด้วยอีเมล/รหัสผ่าน และไม่มีโค้ดเชื่อมบัญชีด้วยอีเมล (PLAN §3)
 *      ⇒ ตั้งอีเมลแล้วไม่กลายเป็นกุญแจเข้าบัญชี · การล็อกอินอ้าง account(provider_id, account_id) เท่านั้น
 *   4. `updated_at` ต้องเขียนเองด้วย now() — ตารางของ Better Auth ไม่มี trigger (docs/schema.sql:286-287)
 *   5. เขียนเป็น statement เดียว (atomic) → ไม่มีช่วงให้สถานะยืนยันพลิกกลางทาง/ไม่มี race
 *   6. userId จาก session เท่านั้น (ห้ามรับ userId จาก input) · ใช้ drizzle ตรง ไม่ใช้ changeEmail ของ better-auth
 *      (ตัวนั้นออกแบบคู่กับ flow ส่งอีเมลยืนยันซึ่งเราไม่มี = พาไปทางตัน)
 *   7. ห้ามคำนวณเงินในไฟล์นี้ (ไม่เกี่ยวกับเงิน) และห้าม log อีเมลทั้งก้อน
 */
import { and, eq, sql } from 'drizzle-orm';

import { PLACEHOLDER_EMAIL_DOMAIN } from '../../lib/line-profile.ts';
import { guardWrite, ValidationError } from '../errors.ts';
import type { Db } from '../index.ts';
import { user } from '../schema.ts';
import type { Session } from '../session.ts';

/** ฟิลด์ที่ยอมรับจาก input — ฟิลด์อื่น (userId, emailVerified, id, …) ระบบกำหนดเอง = ปฏิเสธ */
const ALLOWED_KEYS: readonly string[] = ['email'];

/** เพดานความยาวอีเมลตาม RFC 5321 (ที่อยู่ทั้งก้อน) — เกินกว่านี้ไม่มีผู้ให้บริการรายใดรับ */
const MAX_EMAIL_LENGTH = 254;

/** สั้นสุดที่เป็นไปได้จริง (`a@b.co`) — regex ด้านล่างบังคับไว้แล้ว แต่ตรวจซ้ำให้อ่านกติกาครบในที่เดียว */
const MIN_EMAIL_LENGTH = 6;

/**
 * ตรวจแบบพอใช้ (ไม่แกล้งทำเป็น RFC validator — สเปก §3 ระบุรูปแบบนี้ให้ UI mirror ข้อความเดียวกัน)
 * บังคับ: มี @ เดียว · มีจุดในโดเมน · TLD ≥ 2 ตัว · ไม่มีช่องว่าง
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * โดเมนที่ **ตั้งเองไม่ได้** — ที่อยู่ภายในของเรา + โดเมนที่ RFC 2606/6761 สงวนไว้ (ไม่มีทางเป็นอีเมลจริง)
 * ประกาศที่เดียวในไฟล์นี้ · `PLACEHOLDER_EMAIL_DOMAIN` (`line.local`) ถูกคุมด้วย `.local` อยู่แล้ว
 * แต่ใส่ไว้ตรง ๆ เพื่อให้อ่านรายการแล้วเห็นที่อยู่ภายในของเราชัด ๆ (และกันคนเผลอถอด `.local` ออก)
 */
const RESERVED_EMAIL_DOMAINS: readonly string[] = [
  PLACEHOLDER_EMAIL_DOMAIN,
  'local',
  'invalid',
  'test',
  'example',
  'localhost',
];

const MESSAGES = {
  /** unique `user_email_key` — ห้ามบอกว่าเป็นของใคร (สเปก §3) */
  emailTaken: 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว — ลองอีเมลอื่น',
  reservedDomain: 'ใช้โดเมนอีเมลจริง (ไม่ใช่ที่อยู่ภายในระบบ)',
  verified: 'อีเมลนี้ยืนยันแล้ว แก้เองไม่ได้ (อีเมลจากผู้ให้บริการ — แก้ที่ต้นทางแล้วล็อกอินใหม่)',
  noEmailField: 'ไม่พบอีเมลที่ต้องการบันทึก (ส่ง null หรือช่องว่างเมื่อต้องการล้างอีเมล)',
  unknownField: 'ไม่อนุญาตให้ส่งข้อมูลที่ไม่รองรับมา',
} as const;

export type SavedOwnEmail = {
  /** ค่าที่บันทึกจริง (null = ล้างอีเมลออกแล้ว → "ยังไม่ได้ตั้งอีเมล") */
  email: string | null;
  /** อ่านจากค่า RETURNING ของ DB — ตั้งเองได้ false เท่านั้น (verified = true ถูกปฏิเสธก่อนถึงบรรทัดนี้) */
  emailVerified: boolean;
};

/** โดเมนของอีเมล (ส่วนหลัง @ ตัวสุดท้าย) — ไม่ต้องรอให้ผ่าน EMAIL_PATTERN เพราะเช็คโดเมนสงวนก่อนเช็ครูปแบบ */
const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1);

const isReservedDomain = (domain: string) =>
  RESERVED_EMAIL_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`));

/**
 * normalize + ตรวจอีเมล (รับเฉพาะสตริง) → ค่าที่พร้อมเก็บ หรือ null เมื่อสตริงว่าง/ช่องว่างล้วน = ล้างอีเมล
 */
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') throw new ValidationError('อีเมลต้องเป็นข้อความ');

  const normalized = value.trim().toLowerCase();
  if (normalized === '') return null;

  // DB บังคับ `email = lower(btrim(email))` (docs/schema.sql:44) — normalize ให้ตรงแล้ว อย่าไปพึ่ง check
  if (normalized.length < MIN_EMAIL_LENGTH || normalized.length > MAX_EMAIL_LENGTH) {
    throw new ValidationError(`อีเมลต้องยาว ${MIN_EMAIL_LENGTH}–${MAX_EMAIL_LENGTH} ตัวอักษร`);
  }
  // โดเมนสงวนตรวจก่อนรูปแบบ: `g@localhost` ไม่มีจุด (จะตกที่ "รูปแบบไม่ถูกต้อง") แต่สาเหตุจริงคือ
  // "เป็นที่อยู่ภายในระบบ" ซึ่งบอกผู้ใช้ตรงกว่า — และทำให้รายการโดเมนสงวนด้านบนเอื้อมถึงได้จริงทุกตัว
  if (isReservedDomain(domainOf(normalized))) throw new ValidationError(MESSAGES.reservedDomain);
  if (!EMAIL_PATTERN.test(normalized)) throw new ValidationError('รูปแบบอีเมลไม่ถูกต้อง');

  return normalized;
}

/**
 * ตั้ง/แก้/ล้างอีเมลของผู้ใช้ใน session — คืนค่าที่บันทึกจริง
 *
 * `input` = `{ email: string | null }` · `email: null` หรือช่องว่าง = **ล้างอีเมล** (กลับไป "ยังไม่ได้ตั้งอีเมล")
 * · ไม่ส่งฟิลด์ `email` มาเลย = ValidationError (กันการเผลอลบด้วย payload ที่ดรอปฟิลด์ทิ้ง เช่น JSON ที่มี undefined)
 */
export async function setOwnEmail(db: Db, session: Session, input: unknown): Promise<SavedOwnEmail> {
  if (typeof input !== 'object' || input === null) throw new ValidationError(MESSAGES.noEmailField);
  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.includes(key)) throw new ValidationError(MESSAGES.unknownField);
  }
  if (raw.email === undefined) throw new ValidationError(MESSAGES.noEmailField);
  // null = ตั้งใจล้างอีเมล (คนละเรื่องกับ "ไม่ได้ส่งฟิลด์มา" ที่ถูกตัดไปข้างบนแล้ว)
  const email = raw.email === null ? null : normalizeEmail(raw.email);

  // statement เดียวทั้งคุมสิทธิ์ (email_verified = false) และกัน unique — ไม่มีช่องให้ verified พลิกกลางทาง
  const rows = await guardWrite(
    () =>
      db
        .update(user)
        .set({ email, emailVerified: false, updatedAt: sql`now()` })
        .where(and(eq(user.id, session.userId), eq(user.emailVerified, false)))
        .returning({ emailVerified: user.emailVerified }),
    { '23505': MESSAGES.emailTaken },
  );

  const row = rows[0];
  if (!row) {
    // 0 แถว = ไม่มีสิทธิ์เขียน (verified ไปแล้ว) หรือไม่มีผู้ใช้ → ยิงเพิ่ม 1 query เฉพาะ "เส้นที่แพ้" เพื่อบอกสาเหตุจริง
    const current = await guardWrite(() =>
      db.select({ emailVerified: user.emailVerified }).from(user).where(eq(user.id, session.userId)),
    );
    if (current.length === 0) throw new ValidationError('ไม่พบผู้ใช้คนนี้ในระบบ');
    throw new ValidationError(MESSAGES.verified);
  }

  return { email, emailVerified: row.emailVerified };
}
