import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { Session } from '@/db/session';
import { getAuth } from '@/lib/auth';

/** ผู้ใช้ที่ล็อกอิน + ข้อมูลที่หน้าจอใช้บอกว่า "เป็นใคร" (มาจาก session เท่านั้น) */
export type SessionUser = Session & { name: string; email: string | null };

/**
 * อ่าน session จาก cookie ผ่าน Better Auth — ฝั่ง server เท่านั้น
 *
 * กติกา:
 *   - `getAuth()` ถูกเรียกตอน request เสมอ (ห้ามเรียกตอน import — มีคอมเมนต์อธิบายใน src/lib/auth.ts)
 *   - userId มาจาก session เท่านั้น ห้ามอ่านจาก query/body/header ที่ผู้ใช้คุม (src/db/session.ts)
 */
async function readSession(): Promise<SessionUser | null> {
  const result = await getAuth().api.getSession({ headers: await headers() });
  if (!result) return null;
  return { userId: result.user.id, name: result.user.name, email: result.user.email ?? null };
}

/** `{ userId }` หรือ null — รูปแบบเดียวกับที่ชั้น query/mutation ต้องการ */
export async function getSession(): Promise<Session | null> {
  const user = await readSession();
  return user ? { userId: user.userId } : null;
}

/**
 * หน้าที่เข้าได้เฉพาะคนล็อกอินแล้ว: ไม่มี session → /login
 *
 * `redirect()` ทำงานด้วยการโยน exception เพื่อหยุด render — **ห้ามครอบ try/catch**
 * (กลืนแล้วจะ render หน้าถัดไปต่อทั้งที่ไม่มีผู้ใช้)
 */
export async function requireSession(): Promise<SessionUser> {
  const user = await readSession();
  if (!user) redirect('/login');
  return user;
}
