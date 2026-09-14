'use server';

import { revalidatePath } from 'next/cache';

import { getDb } from '@/db';
import { ValidationError } from '@/db/errors';
import { restoreTransaction } from '@/db/mutations/transactions';
import { isNextControlFlow } from '@/lib/next-signals';
import { getSession } from '@/lib/session';
import { logServer } from '@/lib/log';

export type RestoreResult = { ok: true } | { ok: false; message: string };

/** เซสชันหาย/ตรวจไม่ได้ — บอกตรง ๆ ไม่เด้งไป /login (ผู้ใช้จะเข้าใจผิดว่าถูกออกจากระบบ) */
const SIGNED_OUT = 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่แล้วลองอีกครั้ง';

/**
 * กู้คืนรายการที่ลบ (wave21) — 1 แตะ ไม่มีขั้นยืนยัน (กู้คืนไม่ทำลายข้อมูล ต่างจากการลบที่เป็น 2 ขั้น)
 *
 * ชั้นข้อมูลโยน `ValidationError` ข้อความไทยเมื่อ: แถวไม่ได้ถูกลบ · ไม่ใช่ของเรา · ถูกลบไปแล้ว/กู้ไปแล้ว
 * หรือ **กระเป๋า/หมวดของมันถูกเลิกใช้** (ข้อความบอกทางแก้) → ส่งต่อข้อความนั้น ไม่กลายเป็น 500
 */
export async function restoreTransactionAction(id: string): Promise<RestoreResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };

    await restoreTransaction(getDb(), session, id);

    // ตัวเลขทุกหน้ากลับมาเท่าเดิม เพราะ query ของทุกหน้าตรวจ `deleted_at is null` อยู่แล้ว
    // (occurred_at ไม่ถูกแตะ → รายการกลับไปเดือนเดิมเสมอ)
    revalidatePath('/settings/trash');
    revalidatePath('/');
    revalidatePath('/transactions');
    revalidatePath('/summary');
    return { ok: true };
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    if (error instanceof ValidationError) return { ok: false, message: error.message };
    logServer('transactions.restore_failed', { error });
    return { ok: false, message: 'กู้คืนไม่สำเร็จ ลองใหม่' };
  }
}
