'use server';

import { revalidatePath } from 'next/cache';

import { getDb } from '@/db';
import { ValidationError } from '@/db/errors';
import { deleteBudget, setBudget } from '@/db/mutations/budgets';
import { periodMonthOfBkk } from '@/lib/month';
import { requireSession } from '@/lib/session';

export type BudgetResult = { ok: true } | { ok: false; message: string };

/**
 * ข้อความที่ให้ผู้ใช้เห็น: ValidationError เป็นข้อความไทยที่ตั้งใจเขียนไว้แล้ว
 * error อื่น (DB ล่ม/บั๊ก) ห้ามให้ข้อความดิบหรือรหัสหลุดถึงผู้ใช้ (design §4) — log ไว้ฝั่ง server
 */
function userMessage(error: unknown): string {
  if (error instanceof ValidationError) return error.message;
  console.error('[jodjai] budget write failed:', error);
  return 'บันทึกไม่สำเร็จ ลองใหม่';
}

/**
 * ตั้ง/แก้งบของเดือนปัจจุบัน — userId มาจาก session เท่านั้น ไม่รับจาก client
 * periodMonth ตรึงที่เดือนปัจจุบันเพราะทั้งแอปยังสลับเดือนไม่ได้ (ข้อเสนอ §2) — signature ของ mutation รับเดือนอยู่แล้ว
 */
export async function saveBudgetAction(categoryId: string, amount: number): Promise<BudgetResult> {
  const { userId } = await requireSession();
  try {
    await setBudget(getDb(), { userId }, { categoryId, periodMonth: periodMonthOfBkk(), amount });
    revalidatePath('/settings/budgets');
    revalidatePath('/summary');
    return { ok: true };
  } catch (error) {
    return { ok: false, message: userMessage(error) };
  }
}

/** ล้างงบ (DELETE จริง) — ลบของคนอื่นไม่ได้ เพราะ mutation ผูก userId ของ session */
export async function clearBudgetAction(budgetId: string): Promise<BudgetResult> {
  const { userId } = await requireSession();
  try {
    await deleteBudget(getDb(), { userId }, budgetId);
    revalidatePath('/settings/budgets');
    revalidatePath('/summary');
    return { ok: true };
  } catch (error) {
    return { ok: false, message: userMessage(error) };
  }
}
