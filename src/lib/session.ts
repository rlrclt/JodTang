import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { Session } from '@/db/session';
import { getAuth } from '@/lib/auth';
import { isNextControlFlow } from '@/lib/next-signals';
import { logServer } from './log.ts';

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

/** `{ userId }` หรือ null — โยนเมื่อ "ตรวจไม่ได้" (DB ล่ม) เพื่อให้ผู้เรียกแยกออกจาก "ไม่ได้ล็อกอิน" */
export async function getSession(): Promise<Session | null> {
  const user = await readSession();
  return user ? { userId: user.userId } : null;
}

/** ผลของประตู session: ได้ผู้ใช้ หรือ "ตรวจไม่ได้" (DB ล่ม) — กรณีไม่ได้ล็อกอินจะ redirect ให้เสร็จในนี้ */
export type SessionGate = { user: SessionUser; unavailable?: undefined } | { user?: undefined; unavailable: true };

/**
 * ประตูของหน้าที่ต้องล็อกอิน (ใช้แทน requireSession)
 * - ไม่มี session → redirect('/login')
 * - อ่าน session ไม่ได้ (DB ล่ม/เน็ตขาด) → คืน `unavailable` ให้หน้าเว็บ **แสดง error UI เอง**
 *   ห้าม throw (จะกลายเป็น 500 เปล่า/หน้า 404 อังกฤษ) และห้ามเด้ง /login (ผู้ใช้จะเข้าใจผิดว่าถูกออกจากระบบ)
 *
 * `redirect()` ถูกเรียก "นอก" try โดยตั้งใจ — มันทำงานด้วยการโยน error ถ้าอยู่ใน try จะถูกกลืนเป็น unavailable
 */
export async function gateSession(): Promise<SessionGate> {
  let user: SessionUser | null;
  try {
    user = await readSession();
  } catch (error) {
    // สัญญาณ prerender ของ Next (headers() ตอน build) ต้องโยนต่อ ไม่ใช่ log เป็น error ของเรา
    if (isNextControlFlow(error)) throw error;
    logServer('session.read_failed', { error });
    return { unavailable: true };
  }
  if (!user) redirect('/login');
  return { user };
}
