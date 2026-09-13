'use server';

import { revalidatePath } from 'next/cache';

import { getDb } from '@/db';
import { ValidationError } from '@/db/errors';
import { deleteBudget, setBudget } from '@/db/mutations/budgets';
import { periodMonthOfBkk } from '@/lib/month';
import { isNextControlFlow } from '@/lib/next-signals';
import { getSession } from '@/lib/session';

export type BudgetResult = { ok: true } | { ok: false; message: string };

/** เซสชันหาย/ตรวจไม่ได้ — บอกตรง ๆ ไม่เด้งไป /login (ผู้ใช้จะเข้าใจผิดว่าถูกออกจากระบบ) */
const SIGNED_OUT = 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่แล้วลองอีกครั้ง';

/**
 * ข้อความที่ให้ผู้ใช้เห็น: ValidationError เป็นข้อความไทยที่ตั้งใจเขียนไว้แล้ว
 * error อื่น (DB ล่ม/เน็ตขาด/บั๊ก) ห้ามให้ข้อความดิบหรือรหัสหลุดถึงผู้ใช้ (design §4) — log ไว้ฝั่ง server
 */
function userMessage(error: unknown, fallback: string): string {
  if (error instanceof ValidationError) return error.message;
  console.error('[jodjai] budget write failed:', error);
  return fallback;
}

/**
 * ตั้ง/แก้งบของเดือนปัจจุบัน — userId มาจาก session เท่านั้น ไม่รับจาก client
 * periodMonth ตรึงที่เดือนปัจจุบันเพราะทั้งแอปยังสลับเดือนไม่ได้ (ข้อเสนอ §2) — signature ของ mutation รับเดือนอยู่แล้ว
 *
 * ใช้ getSession() ไม่ใช่ requireSession(): ใน server action `redirect()` โยน error พิเศษออกมา
 * ถ้าให้อยู่ใน try/catch จะถูกกลืนกลายเป็น "บันทึกไม่สำเร็จ" เงียบ ๆ · ทุกอย่างในนี้ต้องคืน ok:false ไม่ throw
 */
export async function saveBudgetAction(categoryId: string, amount: number): Promise<BudgetResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };
    await setBudget(getDb(), session, { categoryId, periodMonth: periodMonthOfBkk(), amount });
    revalidatePath('/settings/budgets');
    revalidatePath('/summary');
    return { ok: true };
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // redirect()/notFound() ของ Next — ห้ามกลืนเป็น ok:false
    return { ok: false, message: userMessage(error, 'บันทึกไม่สำเร็จ ลองใหม่') };
  }
}

/** ล้างงบ (DELETE จริง) — ลบของคนอื่นไม่ได้ เพราะ mutation ผูก userId ของ session */
export async function clearBudgetAction(budgetId: string): Promise<BudgetResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };
    await deleteBudget(getDb(), session, budgetId);
    revalidatePath('/settings/budgets');
    revalidatePath('/summary');
    return { ok: true };
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // redirect()/notFound() ของ Next — ห้ามกลืนเป็น ok:false
    return { ok: false, message: userMessage(error, 'ล้างงบไม่สำเร็จ ลองใหม่') };
  }
}
