'use server';

import { revalidatePath } from 'next/cache';

import { getDb } from '@/db';
import { ValidationError } from '@/db/errors';
import { addCategory, archiveCategory, restoreCategory, updateCategory } from '@/db/mutations/categories';
import { isNextControlFlow } from '@/lib/next-signals';
import { getSession } from '@/lib/session';

export type ManageResult = { ok: true } | { ok: false; message: string };

/** เซสชันหาย/ตรวจไม่ได้ — บอกตรง ๆ ไม่เด้งไป /login (ผู้ใช้จะเข้าใจผิดว่าถูกออกจากระบบ) */
const SIGNED_OUT = 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่แล้วลองอีกครั้ง';

/** ข้อความของ unique ชื่อซ้ำ — ต้องบอกบริบท "หมวดที่ใช้งาน" (partial unique: ชื่อเดิมหลัง archive ใช้ได้อีก) */
const DUPLICATE_NAME = 'มีชื่อนี้อยู่แล้วในหมวดที่ใช้งาน';

/**
 * 23505 = unique violation (ชื่อซ้ำ) — เดิน cause chain แบบเดียวกับ pgCode() ใน src/db/errors.ts
 * ไม่เทียบ "ข้อความ" เพราะข้อความอาจถูกแปล/แก้ได้ — รหัส PG คือสัญญาที่มั่นคงกว่า
 * (ใช้ `in` narrowing ไม่ cast: ค่าที่ส่งเข้ามาเป็น unknown จาก catch)
 */
function isDuplicateName(error: unknown): boolean {
  let node: unknown = error;
  for (let depth = 0; node && typeof node === 'object' && depth < 4; depth++) {
    if ('code' in node && node.code === '23505') return true;
    node = 'cause' in node ? node.cause : undefined;
  }
  return false;
}

/**
 * ข้อความที่ให้ผู้ใช้เห็น: 23505 → ข้อความของหน้านี้ · ValidationError = ข้อความไทยที่ชั้นข้อมูลเขียนไว้
 * error อื่น (DB ล่ม/บั๊ก) ห้ามให้ข้อความดิบหรือรหัสหลุดถึงผู้ใช้ — log ไว้ฝั่ง server (design §4)
 */
function categoryMessage(error: unknown, fallback: string): string {
  if (isDuplicateName(error)) return DUPLICATE_NAME;
  if (error instanceof ValidationError) return error.message;
  console.error('[jodjai] category write failed:', error);
  return fallback;
}

/**
 * เพิ่ม/แก้หมวด — userId มาจาก session เท่านั้น
 * - ไม่ส่ง `id` = เพิ่มใหม่ (ต้องมี kind) · ส่ง `id` = แก้ (ส่ง kind ไม่ได้ — ชั้นข้อมูลจะปฏิเสธ)
 * - สีเดิมที่บันทึกไว้จะถูกรักษาไว้ถ้าไม่ได้เลือกใหม่ (client ส่งค่าปัจจุบันกลับมาเสมอ)
 */
export async function saveCategoryAction(input: {
  id?: string;
  kind: 'income' | 'expense';
  name: string;
  color: string | null;
}): Promise<ManageResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };

    const db = getDb();
    if (input.id) {
      await updateCategory(db, session, input.id, { name: input.name, color: input.color });
    } else {
      await addCategory(db, session, { kind: input.kind, name: input.name, color: input.color });
    }

    revalidatePath('/settings/categories');
    revalidatePath('/transactions');
    revalidatePath('/summary');
    return { ok: true };
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // redirect()/notFound() ของ Next — ห้ามกลืนเป็น ok:false
    return { ok: false, message: categoryMessage(error, 'บันทึกไม่สำเร็จ ลองใหม่') };
  }
}

/** เลิกใช้หมวด (ตั้ง archived_at) — รายการเก่ายังอยู่และยังนับในยอด (spec §4) */
export async function archiveCategoryAction(id: string): Promise<ManageResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };
    await archiveCategory(getDb(), session, id);
    revalidatePath('/settings/categories');
    revalidatePath('/transactions');
    revalidatePath('/summary');
    return { ok: true };
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    return { ok: false, message: categoryMessage(error, 'เลิกใช้หมวดไม่สำเร็จ ลองใหม่') };
  }
}

/** กู้คืนหมวดที่เลิกใช้แล้ว — ชื่อชนกับตัว active จะได้ 23505 → ข้อความไทย (spec §4) */
export async function restoreCategoryAction(id: string): Promise<ManageResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };
    await restoreCategory(getDb(), session, id);
    revalidatePath('/settings/categories');
    revalidatePath('/transactions');
    revalidatePath('/summary');
    return { ok: true };
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    return { ok: false, message: categoryMessage(error, 'กู้คืนหมวดไม่สำเร็จ ลองใหม่') };
  }
}
