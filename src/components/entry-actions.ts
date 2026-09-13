'use server';

import { revalidatePath } from 'next/cache';

import { type EntryCategory, type EntryKind, type EntryOptions, SETUP_CATEGORIES } from '@/components/entry-view';
import { getDb } from '@/db';
import { ValidationError } from '@/db/errors';
import { addAccount } from '@/db/mutations/accounts';
import { addCategory } from '@/db/mutations/categories';
import { addTransaction } from '@/db/mutations/transactions';
import { lastUsedAccountId, listAccounts } from '@/db/queries/accounts';
import { firstRunState } from '@/db/queries/user-state';
import { listCategories, suggestedCategoryId, type CategoryRow } from '@/db/queries/categories';
import { isNextControlFlow } from '@/lib/next-signals';
import { getSession } from '@/lib/session';

export type EntryOptionsResult = { ok: true; options: EntryOptions } | { ok: false; message: string };
export type EntryWriteResult = { ok: true } | { ok: false; message: string };
export type EntryCreateResult = { ok: true; id: string } | { ok: false; message: string };

const SIGNED_OUT = 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่แล้วลองอีกครั้ง';

/** 23505 = ชื่อซ้ำ (partial unique) — เดิน cause chain แบบเดียวกับ pgCode() ใน src/db/errors.ts */
function isDuplicateName(error: unknown): boolean {
  let node: unknown = error;
  for (let depth = 0; node && typeof node === 'object' && depth < 4; depth++) {
    if ('code' in node && node.code === '23505') return true;
    node = 'cause' in node ? node.cause : undefined;
  }
  return false;
}

function userMessage(error: unknown, fallback: string, duplicate: string): string {
  if (isDuplicateName(error)) return duplicate;
  if (error instanceof ValidationError) return error.message;
  console.error('[jodjai] entry write failed:', error);
  return fallback;
}

const toEntryCategory = (row: CategoryRow): EntryCategory => ({ id: row.id, name: row.name, color: row.color });

/**
 * ค่าเริ่มต้นทั้งหมดของชีต "เพิ่มรายการ" — **1 server action = 1 round trip** (Promise.all 6 query)
 * ไม่ส่ง props จาก layout เพราะ layout ยัง static (ทำ dynamic จะกระทบทุก route — spec §2)
 */
export async function loadEntryOptions(): Promise<EntryOptionsResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };

    const db = getDb();
    const [accounts, income, expense, lastUsed, suggestedIncome, suggestedExpense] = await Promise.all([
      listAccounts(db, session.userId),
      listCategories(db, session.userId, 'income'),
      listCategories(db, session.userId, 'expense'),
      lastUsedAccountId(db, session.userId),
      suggestedCategoryId(db, session.userId, 'income'),
      suggestedCategoryId(db, session.userId, 'expense'),
    ]);

    return {
      ok: true,
      options: {
        accounts: accounts.map((account) => ({ id: account.id, name: account.name })),
        categories: { income: income.map(toEntryCategory), expense: expense.map(toEntryCategory) },
        lastUsedAccountId: lastUsed,
        suggested: { income: suggestedIncome, expense: suggestedExpense },
      },
    };
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    console.error('[jodjai] โหลดตัวเลือกในชีตไม่สำเร็จ:', error);
    return { ok: false, message: 'โหลดตัวเลือกไม่สำเร็จ ลองใหม่' };
  }
}

/**
 * บันทึกรายการ — userId มาจาก session เท่านั้น
 * ประกอบร่าง input เองทีละฟิลด์ (ไม่ spread ของ client) ⇒ ฟิลด์แปลกปลอมถูกตัดออก
 * โอน: ส่ง toAccountId และ categoryId = null เสมอ · รับ/จ่าย: ตรงข้าม (mutation ตรวจซ้ำอีกชั้น)
 */
export async function saveEntryAction(input: {
  kind: EntryKind;
  amount: number;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  note: string | null;
}): Promise<EntryWriteResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };

    const isTransfer = input.kind === 'transfer';
    await addTransaction(getDb(), session, {
      kind: input.kind,
      amount: input.amount,
      accountId: input.accountId,
      toAccountId: isTransfer ? input.toAccountId : null,
      categoryId: isTransfer ? null : input.categoryId,
      note: input.note && input.note.trim() !== '' ? input.note.trim() : null,
      occurredAt: new Date(),
    });

    revalidatePath('/');
    revalidatePath('/transactions');
    revalidatePath('/summary');
    revalidatePath('/settings/accounts'); // ยอดคงเหลือต่อใบเปลี่ยน
    return { ok: true };
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    return { ok: false, message: userMessage(error, 'บันทึกไม่สำเร็จ ลองใหม่', 'มีรายการซ้ำอยู่แล้ว') };
  }
}

/** สร้างกระเป๋า "เงินสด" ให้ผู้ใช้ที่ยังไม่มีกระเป๋า — 1 แตะ แล้วชีตเลือกให้ทันที (ค่าที่พิมพ์ไม่หาย) */
export async function createCashAccountAction(): Promise<EntryCreateResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };
    const account = await addAccount(getDb(), session, { name: 'เงินสด', kind: 'cash' });
    revalidatePath('/settings/accounts');
    return { ok: true, id: account.id };
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    return { ok: false, message: userMessage(error, 'สร้างกระเป๋าไม่สำเร็จ ลองใหม่', 'มีกระเป๋าชื่อ "เงินสด" อยู่แล้ว') };
  }
}

/** สร้างหมวด 1 แตะ แล้วเลือกให้ทันที (ห้ามพาไปหน้าตั้งค่าหมวดก่อน — spec §2) */
export async function createEntryCategoryAction(input: {
  kind: 'income' | 'expense';
  name: string;
}): Promise<EntryCreateResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };
    const category = await addCategory(getDb(), session, { kind: input.kind, name: input.name });
    revalidatePath('/settings/categories');
    return { ok: true, id: category.id };
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    return { ok: false, message: userMessage(error, 'สร้างหมวดไม่สำเร็จ ลองใหม่', 'มีชื่อนี้อยู่แล้วในหมวดที่ใช้งาน') };
  }
}

export type SetupResult =
  | { ok: true; created: { accounts: number; categories: number }; message: string }
  | { ok: false; message: string };

/**
 * "เริ่มใช้งานเร็ว" — สร้างกระเป๋า "เงินสด" + 5 หมวด (ชื่อ/สีจาก SETUP_CATEGORIES — ชื่อชุดเดิมของแอป)
 *
 * ทนกดซ้ำ/กดครึ่งทาง:
 *   1. เช็ค `firstRunState` ฝั่ง server ก่อนเสมอ — ไม่ใช่ผู้ใช้ใหม่ = ไม่สร้างอะไรเลย
 *   2. 23505 ต่อรายการ = "มีอยู่แล้ว" → ข้ามตัวนั้น ทำตัวถัดไปต่อ (ไม่ล้มทั้งชุด) ⇒ กดซ้ำได้ไม่มีแถวซ้ำ
 *   3. error อื่น (DB ล่ม/เน็ตขาด) = ล้มทั้งชุด คืน ok:false ให้การ์ดโชว์ปุ่มลองใหม่
 */
export async function setupDefaultsAction(): Promise<SetupResult> {
  try {
    const session = await getSession();
    if (!session) return { ok: false, message: SIGNED_OUT };

    const db = getDb();
    const fresh = await firstRunState(db, session.userId);
    if (fresh.hasAccounts || fresh.hasCategories || fresh.hasTransactions) {
      return { ok: true, created: { accounts: 0, categories: 0 }, message: 'มีข้อมูลอยู่แล้ว — ไม่ได้สร้างอะไรเพิ่ม' };
    }

    let accounts = 0;
    try {
      await addAccount(db, session, { name: 'เงินสด', kind: 'cash', initialBalance: 0 });
      accounts = 1;
    } catch (error) {
      if (isNextControlFlow(error)) throw error;
      if (!isDuplicateName(error)) throw error; // ชื่อซ้ำ = มีอยู่แล้ว ข้ามไป
    }

    let categories = 0;
    for (const item of SETUP_CATEGORIES) {
      try {
        await addCategory(db, session, { kind: item.kind, name: item.name, color: item.color });
        categories += 1;
      } catch (error) {
        if (isNextControlFlow(error)) throw error;
        if (!isDuplicateName(error)) throw error;
      }
    }

    revalidatePath('/');
    revalidatePath('/transactions');
    revalidatePath('/summary');
    revalidatePath('/settings/accounts');
    revalidatePath('/settings/categories');

    return {
      ok: true,
      created: { accounts, categories },
      message:
        accounts + categories === 6
          ? 'สร้างกระเป๋าเงินสด + 5 หมวดแล้ว'
          : 'มีอยู่แล้วบางส่วน — ใช้ของเดิมต่อได้เลย',
    };
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    return { ok: false, message: userMessage(error, 'สร้างค่าเริ่มต้นไม่สำเร็จ ลองใหม่', 'มีข้อมูลนี้อยู่แล้ว') };
  }
}
