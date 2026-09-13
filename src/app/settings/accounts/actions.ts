'use server';

import { revalidatePath } from 'next/cache';

import { getDb } from '@/db';
import { ValidationError } from '@/db/errors';
import { addAccount, archiveAccount, restoreAccount, updateAccount } from '@/db/mutations/accounts';
import { isNextControlFlow } from '@/lib/next-signals';
import { getSession } from '@/lib/session';

export type ManageResult = { ok: true } | { ok: false; message: string };

const SIGNED_OUT = 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่แล้วลองอีกครั้ง';

/** ข้อความของ unique ชื่อซ้ำ — ต้องบอกบริบท "กระเป๋าที่ใช้งาน" (ชื่อเดิมหลัง archive ใช้ได้อีก) */
const DUPLICATE_NAME = 'มีชื่อนี้อยู่แล้วในกระเป๋าที่ใช้งาน';

/**
 * 23505 = unique violation (ชื่อซ้ำ) — เดิน cause chain แบบเดียวกับ pgCode() ใน src/db/errors.ts
 * ไม่เทียบข้อความ (ข้อความอาจถูกแปล) · ใช้ `in` narrowing ไม่ cast
 */
function isDuplicateName(error: unknown): boolean {
  let node: unknown = error;
  for (let depth = 0; node && typeof node === 'object' && depth < 4; depth++) {
    if ('code' in node && node.code === '23505') return true;
    node = 'cause' in node ? node.cause : undefined;
  }
  return false;
}

function accountMessage(error: unknown, fallback: string): string {
  if (isDuplicateName(error)) return DUPLICATE_NAME;
  if (error instanceof ValidationError) return error.message;
  console.error('[jodjai] account write failed:', error);
  return fallback;
}

/**
 * เพิ่ม/แก้กระเป๋า — userId มาจาก session เท่านั้น
 * `updateAccount` รวมร่างจากแถวเดิมก่อน validate ⇒ ฟิลด์ที่ไม่ได้ส่ง (icon/color) ยังอยู่ครบ
 * (wave10b §5: คืนช่องยอดตั้งต้นแล้ว เพราะมีที่โชว์ยอดในหน้ากระเป๋า)
 */
export async function saveAccountAction(input: {
  id?: string;
  name: string;
  kind: string;
  /** ยอดตั้งต้น (สตางค์ · ติดลบได้สำหรับบัตรเครดิต) — wave10b §5 คืนช่องนี้หลังมีที่โชว์ยอด */
  initialBalance?: number;
}): Promise<ManageResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };

    const db = getDb();
    if (input.id) {
      await updateAccount(db, session, input.id, {
        name: input.name,
        kind: input.kind,
        ...(input.initialBalance === undefined ? {} : { initialBalance: input.initialBalance }),
      });
    } else {
      await addAccount(db, session, {
        name: input.name,
        kind: input.kind,
        ...(input.initialBalance === undefined ? {} : { initialBalance: input.initialBalance }),
      });
    }

    revalidatePath('/settings/accounts');
    revalidatePath('/transactions');
    return { ok: true };
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // redirect()/notFound() ของ Next — ห้ามกลืนเป็น ok:false
    return { ok: false, message: accountMessage(error, 'บันทึกไม่สำเร็จ ลองใหม่') };
  }
}

/** เลิกใช้กระเป๋า — ชั้นข้อมูลกัน "กระเป๋าใบสุดท้าย" ไว้แล้ว (ข้อความไทยของมันเอง) */
export async function archiveAccountAction(id: string): Promise<ManageResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };
    await archiveAccount(getDb(), session, id);
    revalidatePath('/settings/accounts');
    revalidatePath('/transactions');
    return { ok: true };
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    return { ok: false, message: accountMessage(error, 'เลิกใช้กระเป๋าไม่สำเร็จ ลองใหม่') };
  }
}

/** กู้คืนกระเป๋าที่เลิกใช้แล้ว — ชื่อชนกับตัว active จะได้ 23505 → ข้อความไทย */
export async function restoreAccountAction(id: string): Promise<ManageResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };
    await restoreAccount(getDb(), session, id);
    revalidatePath('/settings/accounts');
    revalidatePath('/transactions');
    return { ok: true };
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    return { ok: false, message: accountMessage(error, 'กู้คืนกระเป๋าไม่สำเร็จ ลองใหม่') };
  }
}
