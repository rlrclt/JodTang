/**
 * อ่าน "โปรไฟล์ที่ใช้อีเมลตัดสินสถานะ" ของผู้ใช้คนเดียว — **1 query** (ไม่มีสูตรเงินในไฟล์นี้)
 *
 * ทำไมต้องมี: UI ต้องแยก 3 สถานะให้ถูก (สเปก wave25 §2)
 *   - `email = null`                        → "ยังไม่ได้ตั้งอีเมล"
 *   - `email` เป็นอีเมลตัวแทน (`@line.local`) → ก็ยังนับเป็น "ยังไม่ได้ตั้งอีเมล" **ห้ามโชว์เป็นอีเมลจริง**
 *   - `email` จริง + `emailVerified`          → ป้าย "ยังไม่ยืนยัน" (แก้ได้) หรือ "ยืนยันแล้ว" (อ่านอย่างเดียว)
 *
 * กติกา:
 *   - อ่านแถว `user` ของ userId ที่ส่งมาเท่านั้น (userId มาจาก session — src/lib/session.ts)
 *   - userId ที่ไม่มีในตาราง = คืน null (ไม่ throw) — ผู้เรียกแยก "ไม่มีผู้ใช้" จาก "ยังไม่มีอีเมล" ได้เอง
 *   - โดเมนตัวแทนอ่านจาก `isPlaceholderEmail()` ที่เดียว (src/lib/line-profile.ts) ห้าม hardcode ซ้ำ
 */
import { eq } from 'drizzle-orm';

import { isPlaceholderEmail } from '../../lib/line-profile.ts';
import type { Db } from '../index.ts';
import { user } from '../schema.ts';

export type UserProfile = {
  /** อีเมลที่เก็บจริงใน DB (null = ยังไม่ได้ตั้ง) — ตัวแทนก็คืนค่าจริง ให้ผู้เรียกตัดสินด้วย usesPlaceholderEmail */
  email: string | null;
  /** true = ยืนยันแล้ว (มาจากผู้ให้บริการ) ⇒ ตั้ง/แก้เองไม่ได้ — ดู src/db/mutations/profile.ts */
  emailVerified: boolean;
  /** true = อีเมลนี้ระบบสร้างให้ (โดเมนตัวแทน) ไม่ใช่ของจริง ⇒ UI โชว์ "ยังไม่ได้ตั้งอีเมล" */
  usesPlaceholderEmail: boolean;
};

export async function getUserProfile(db: Db, userId: string): Promise<UserProfile | null> {
  const rows = await db
    .select({ email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    email: row.email,
    emailVerified: row.emailVerified,
    usesPlaceholderEmail: row.email !== null && isPlaceholderEmail(row.email),
  };
}
