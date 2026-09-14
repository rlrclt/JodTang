'use server';

import { revalidatePath } from 'next/cache';

import { getDb } from '@/db';
import { ValidationError } from '@/db/errors';
import { setOwnEmail } from '@/db/mutations/profile';
import { isNextControlFlow } from '@/lib/next-signals';
import { getSession } from '@/lib/session';
import { logServer } from '@/lib/log';

/**
 * ผลลัพธ์ที่ UI ใช้ได้ทันที — **ค่ามาจาก DB จริง** (UPDATE … RETURNING ในชั้นข้อมูล) ไม่ใช่ค่าที่ผู้ใช้พิมพ์
 * ⇒ ฝั่ง client แสดงผลแบบ optimistic ได้โดยไม่ต้องเดา และไม่ต้องยิง query เพิ่มเพื่อยืนยัน
 */
export type SaveEmailResult =
  | { ok: true; email: string | null; emailVerified: boolean }
  | { ok: false; message: string };

/** เซสชันหาย/ตรวจไม่ได้ — บอกตรง ๆ ไม่เด้งไป /login (ผู้ใช้จะเข้าใจผิดว่าถูกออกจากระบบ) */
const SIGNED_OUT = 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่แล้วลองอีกครั้ง';

/**
 * ตั้ง/แก้อีเมลของตัวเอง (wave25) — `email: null` หรือช่องว่าง = **ล้างอีเมล** (กลับเป็น "ยังไม่ได้ตั้งอีเมล")
 *
 * กติกาความปลอดภัย (บังคับที่ชั้นข้อมูล ไม่ใช่แค่ UI):
 * - ตั้งเองได้เฉพาะผู้ใช้ที่ยังไม่ยืนยันอีเมล · ผลลัพธ์ `emailVerified = false` เสมอ (แอปไม่มีการส่งอีเมลยืนยัน)
 * - ผู้ใช้ที่ยืนยันแล้ว (Google) → ชั้นข้อมูลปฏิเสธทั้งตั้งและล้าง ⇒ คืนข้อความไทย ไม่ใช่ 500
 * - ⚠ **ไม่ใช่กุญแจเชื่อมบัญชีข้าม provider** (PLAN §3): การล็อกอินยังอ้าง `account(provider_id, account_id)`
 *   และ v1 ไม่มีล็อกอินด้วยอีเมล/รหัสผ่าน ⇒ ตั้งอีเมลแล้วไม่ได้สิทธิ์เข้าระบบเพิ่ม
 *
 * `email`/`emailVerified` ที่คืน = ค่าที่บันทึกจริงจาก statement เดียวของ `setOwnEmail` (RETURNING)
 * — ไม่มีการอ่านซ้ำใน action นี้ (ชื่อฟังก์ชันไม่ตรงกับค่าที่ส่งมาก็ได้ เช่นส่งช่องว่าง = ล้าง → คืน `email: null`)
 */
export async function saveEmailAction(input: { email: string | null }): Promise<SaveEmailResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };

    const saved = await setOwnEmail(getDb(), session, { email: input.email });

    // แถวบัญชีอ่านค่าจาก DB (getUserProfile) — ต้อง revalidate ไม่งั้นยังเห็นค่าเดิม
    revalidatePath('/settings');
    return { ok: true, email: saved.email, emailVerified: saved.emailVerified };
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    if (error instanceof ValidationError) return { ok: false, message: error.message };
    logServer('profile.save_failed', { error });
    return { ok: false, message: 'บันทึกอีเมลไม่สำเร็จ ลองใหม่' };
  }
}
