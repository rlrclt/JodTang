/**
 * Write path ของรายการ (เพิ่ม/แก้/ลบ) — คู่กับ src/db/queries/transactions.ts
 *
 * กติกาของไฟล์นี้ (docs/schema.sql + docs/design.md §4 S3):
 *   1. userId มาจาก session เท่านั้น — input ที่ส่ง userId/user_id/id/deletedAt/currency เข้ามาถูกปฏิเสธ
 *   2. validate ก่อนยิง SQL เท่าที่ตรวจได้แบบ sync (รูปร่างตาม transactions_shape_ck · kind · ช่วง/จำนวนเต็มของ amount)
 *      ส่วนที่ validate ไม่ได้ (uuid ผิดรูป · กระเป๋า/หมวดไม่มีอยู่หรือไม่ใช่ของผู้ใช้นี้ · kind ไม่ตรงกับหมวด · check ของ DB)
 *      DB เป็นคนกัน แล้ว toUserError() แปลเป็น ValidationError ข้อความไทยที่จุดเดียว — ห้ามให้ .message ของ drizzle (มี SQL เต็ม) ถึงผู้ใช้
 *   3. ลบ = soft delete (ตั้ง deletedAt) ห้าม DELETE จริง (ยอดเดือนที่สรุปไปแล้วต้องไม่หายย้อนหลัง)
 *   4. ห้ามคำนวณเงินในชั้นนี้ (ไม่มีสูตร/ผลรวม) — ยอดคิดที่ src/lib/money.ts
 *   5. ทุก statement ผูกด้วย userId ของ session (eq(transactions.userId, …)) — ลบ/แก้ของคนอื่นไม่ได้
 *
 * Server action (เฟส 2) จะเป็นคนเรียกฟังก์ชันเหล่านี้ โดยดึง userId จาก session จริง
 * — ยังไม่เขียนตอนนี้เพราะต้องมี credential ก่อน (ตัว layer นี้ทดสอบได้ครบด้วย PGlite)
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { formatSatang, toSatang } from '../../lib/money.ts';
import { alias } from 'drizzle-orm/pg-core';

import { guardWrite, ValidationError } from '../errors.ts';
import type { Db } from '../index.ts';
import { TXN_COLUMNS, toRows, type TxnRow } from '../queries/transactions.ts';
import { accounts, categories, transactions } from '../schema.ts';
import type { Session } from '../session.ts';


/** ส่งต่อให้ผู้เรียกเดิมใช้ได้เหมือนเดิม (ย้ายบ้านไป errors.ts แล้ว) */
export { ValidationError, toUserError } from '../errors.ts';

export type TxnKindInput = 'income' | 'expense' | 'transfer';

export type ValidTransaction = {
  kind: TxnKindInput;
  /** สตางค์ จำนวนเต็ม > 0 */
  amount: number;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  note: string | null;
  occurredAt: Date | null;
};

const KINDS: readonly TxnKindInput[] = ['income', 'expense', 'transfer'];
/** ฟิลด์ที่ยอมรับจาก input — ที่ไม่อยู่ในลิสต์ (userId, id, deletedAt, currency, …) = ปฏิเสธ */
const ALLOWED_KEYS: readonly string[] = [
  'kind',
  'amount',
  'accountId',
  'toAccountId',
  'categoryId',
  'note',
  'occurredAt',
];
/** เพดานเดียวกับ schema.sql (amount > 0 and amount < 1e15) */
const MAX_SATANG = 1_000_000_000_000_000;
/** เพดานความยาวโน้ต (audit F4) — กัน payload ยาวผิดปกติ ไม่ใช่ข้อจำกัดการใช้งานจริง (โน้ตทั่วไปสั้นกว่านี้มาก) */
const MAX_NOTE_LENGTH = 500;
const CURRENCY = 'THB';

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`ต้องระบุ${field}`);
  }
  return value;
}

/**
 * ตรวจกติกาทั้งชุดของรายการหนึ่งแถว (ใช้ทั้งตอนเพิ่มและตอนแก้ — ตอนแก้ประกอบร่างใหม่ก่อนแล้วเรียกตัวเดียวกัน)
 * โยน ValidationError เสมอเมื่อไม่ผ่าน เพื่อให้ผู้เรียกแยกออกจาก error ของ DB
 */
export function validateTransaction(input: unknown): ValidTransaction {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('รูปแบบข้อมูลรายการไม่ถูกต้อง');
  }
  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new ValidationError('ไม่อนุญาตให้ส่งข้อมูลที่ไม่รองรับมา');
    }
  }

  const { kind } = raw;
  if (typeof kind !== 'string' || !KINDS.includes(kind as TxnKindInput)) {
    throw new ValidationError('ประเภทรายการไม่ถูกต้อง (ต้องเป็นรับ จ่าย หรือโอน)');
  }

  let amount: number;
  try {
    amount = toSatang(raw.amount, 'จำนวนเงิน');
  } catch (error) {
    throw new ValidationError((error as Error).message);
  }
  if (amount <= 0) throw new ValidationError('จำนวนเงินต้องมากกว่า 0');
  if (amount >= MAX_SATANG) throw new ValidationError(`จำนวนเงินสูงเกินเพดานที่ระบบรองรับ (สูงสุด ${formatSatang(MAX_SATANG - 1)})`);

  const accountId = requiredText(raw.accountId, 'กระเป๋าเงิน');
  const toAccountId = raw.toAccountId == null ? null : requiredText(raw.toAccountId, 'กระเป๋าปลายทาง');
  const categoryId = raw.categoryId == null ? null : requiredText(raw.categoryId, 'หมวด');

  if (raw.note != null && typeof raw.note !== 'string') throw new ValidationError('โน้ตต้องเป็นข้อความ');
  const note = typeof raw.note === 'string' ? raw.note : null;
  // เพดานความยาว (audit F4): ข้อความที่ผู้ใช้พิมพ์ = ข้อมูลของเขา → ห้ามตัดทิ้งเงียบ ๆ ต้องบอกให้รู้
  if (note !== null && note.length > MAX_NOTE_LENGTH) {
    throw new ValidationError(`โน้ตยาวเกิน ${MAX_NOTE_LENGTH} ตัวอักษร`);
  }

  let occurredAt: Date | null = null;
  if (raw.occurredAt != null && raw.occurredAt !== '') {
    const value = raw.occurredAt instanceof Date ? raw.occurredAt : new Date(String(raw.occurredAt));
    if (Number.isNaN(value.getTime())) throw new ValidationError('วันที่ไม่ถูกต้อง');
    occurredAt = value;
  }

  // รูปร่างของรายการ — ตรงกับ transactions_shape_ck ฝั่ง DB (validate ที่นี่เพื่อให้ได้ข้อความไทยก่อนถึง DB)
  if (kind === 'transfer') {
    if (!toAccountId) throw new ValidationError('โอนต้องระบุกระเป๋าปลายทาง');
    if (toAccountId === accountId) throw new ValidationError('โอนเข้ากระเป๋าเดียวกันไม่ได้');
    if (categoryId) throw new ValidationError('โอนต้องไม่มีหมวด');
  } else {
    if (!categoryId) throw new ValidationError('รับ/จ่ายต้องระบุหมวด');
    if (toAccountId) throw new ValidationError('รับ/จ่ายต้องไม่มีกระเป๋าปลายทาง');
  }

  return { kind: kind as TxnKindInput, amount, accountId, toAccountId, categoryId, note, occurredAt };
}

/** ฟิลด์ที่แก้ได้ (kind เปลี่ยนไม่ได้ — เปลี่ยนแล้วรูปร่าง to_account/category ต้องรื้อ) */
export type TransactionPatch = Partial<
  Pick<ValidTransaction, 'amount' | 'accountId' | 'toAccountId' | 'categoryId' | 'note' | 'occurredAt'>
>;

/**
 * ความหมายของ `occurredAt` ใน patch: ส่ง `null` หรือ `''` = **คงค่าเดิม** (ไม่ใช่ล้าง — คอลัมน์เป็น not null ล้างไม่ได้)
 * ต่างจาก add ที่ไม่ส่ง = DB ใส่ now() · ส่งค่าจริงใน patch = เปลี่ยนเป็นค่านั้น
 */

/**
 * เพิ่มรายการ — userId มาจาก session (พารามิเตอร์) ไม่ใช่จาก input
 * `occurredAt` ไม่ส่ง/ส่ง '' = ให้ DB ใส่ now() (เวลาที่บันทึกจริง) — คนละความหมายกับ patch ของ update ที่ส่ง null = คงค่าเดิม
 */
export async function addTransaction(db: Db, session: Session, input: unknown): Promise<TxnRow> {
  const data = validateTransaction(input);

  const rows = await guardWrite(() =>
    db
      .insert(transactions)
      .values({
      userId: session.userId,
      kind: data.kind,
      amount: data.amount,
      accountId: data.accountId,
      toAccountId: data.toAccountId,
      categoryId: data.categoryId,
      currency: CURRENCY,
      note: data.note,
        ...(data.occurredAt ? { occurredAt: data.occurredAt } : {}),
      })
      .returning(TXN_COLUMNS),
  );

  return toRows(rows)[0];
}

/** แถวที่ยังไม่ถูกลบของผู้ใช้คนนี้เท่านั้น (ใช้ทั้งแก้และลบ) */
const ownLiveRow = (session: Session, id: string) =>
  and(eq(transactions.id, id), eq(transactions.userId, session.userId), isNull(transactions.deletedAt));

/**
 * แก้รายการ: อ่านของเดิม (ของผู้ใช้คนนี้ ยังไม่ถูกลบ) → ประกอบร่างใหม่ → validate ด้วยกติกาชุดเดียวกับตอนสร้าง → update
 * ทำแบบนี้เพราะการแก้ทีละฟิลด์อาจทำให้รูปร่างผิดกติกา (เช่นล้างหมวดของรายจ่าย)
 */
export async function updateTransaction(
  db: Db,
  session: Session,
  id: string,
  patch: unknown,
): Promise<TxnRow> {
  const rowId = requiredText(id, 'id ของรายการ');
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new ValidationError('รูปแบบข้อมูลที่แก้ไม่ถูกต้อง');
  }
  if ('kind' in (patch as Record<string, unknown>)) {
    throw new ValidationError('เปลี่ยนประเภทรายการไม่ได้ — ให้ลบแล้วสร้างใหม่');
  }

  const current = await guardWrite(() =>
    db
      .select({ ...TXN_COLUMNS, note: transactions.note })
      .from(transactions)
      .where(ownLiveRow(session, rowId)),
  );
  if (current.length === 0) throw new ValidationError('ไม่พบรายการนี้ (อาจถูกลบไปแล้วหรือไม่ใช่ของคุณ)');

  const before = current[0];
  const merged = validateTransaction({
    kind: before.kind,
    amount: before.amount,
    accountId: before.accountId,
    toAccountId: before.toAccountId,
    categoryId: before.categoryId,
    note: before.note,
    occurredAt: before.occurredAt,
    ...(patch as Record<string, unknown>),
  });

  const rows = await guardWrite(() =>
    db
      .update(transactions)
      .set({
        amount: merged.amount,
        accountId: merged.accountId,
        toAccountId: merged.toAccountId,
        categoryId: merged.categoryId,
        note: merged.note,
        ...(merged.occurredAt ? { occurredAt: merged.occurredAt } : {}),
      })
      .where(ownLiveRow(session, rowId))
      .returning(TXN_COLUMNS),
  );

  // (A) แพ้การแข่ง: แถวถูกลบ/หายไประหว่าง select กับ update → ต้องได้ ValidationError แบบเดียวกับ softDelete
  // (ไม่ใช่ toRows([])[0] = undefined ที่ผู้เรียกไปพังเป็น TypeError = 500)
  if (rows.length === 0) {
    throw new ValidationError('ไม่พบรายการนี้ (อาจถูกลบไปแล้วหรือไม่ใช่ของคุณ)');
  }
  return toRows(rows)[0];
}

/** ลบรายการ = ตั้ง deletedAt (soft delete) — ไม่มี DELETE จริงในชั้นนี้ */
export async function softDeleteTransaction(
  db: Db,
  session: Session,
  id: string,
): Promise<{ id: string }> {
  const rowId = requiredText(id, 'id ของรายการ');

  const rows = await guardWrite(() =>
    db
      .update(transactions)
      .set({ deletedAt: new Date() })
      .where(ownLiveRow(session, rowId))
      .returning({ id: transactions.id }),
  );

  if (rows.length === 0) {
    throw new ValidationError('ไม่พบรายการนี้ (อาจถูกลบไปแล้วหรือไม่ใช่ของคุณ)');
  }
  return rows[0];
}

/** แถวที่ถูกลบแล้วของผู้ใช้คนนี้เท่านั้น (กู้คืนได้เฉพาะของที่ลบอยู่) */
const ownDeletedRow = (session: Session, id: string) =>
  and(eq(transactions.id, id), eq(transactions.userId, session.userId), isNotNull(transactions.deletedAt));

/** แถวนี้พร้อมสถานะ archive ของกระเป๋า/หมวดที่มันอ้างถึง (1 query — ใช้ตัดสินว่ากู้คืนได้ไหม) */
type RestorableRow = {
  id: string;
  deletedAt: Date | null;
  accountArchivedAt: Date | null;
  toAccountArchivedAt: Date | null;
  categoryArchivedAt: Date | null;
};

/**
 * กู้คืนรายการที่ถูกลบ (ตั้ง `deleted_at = null`) — คู่กับการลบแบบ soft delete
 *
 * กติกาที่เลือก (เขียนให้ชัดเพราะผู้ใช้เห็นข้อความ):
 *   1. กู้คืนได้เฉพาะแถวที่ **ถูกลบอยู่** และเป็นของผู้ใช้คนนี้ — แถวที่ยังไม่ถูกลบ = ValidationError
 *      "รายการนี้ไม่ได้ถูกลบอยู่" (ไม่ใช่ no-op เงียบ ๆ ที่ทำให้ผู้ใช้เข้าใจว่ากดสำเร็จ)
 *   2. **ห้ามกู้คืนถ้ากระเป๋าหรือหมวดของรายการนั้นถูก archive ไปแล้ว** → โยน ValidationError ที่บอกทางแก้
 *      (กู้คืนกระเป๋า/หมวดก่อน) เพราะถ้าปล่อยให้กลับมา รายการนั้นจะอ้างของที่ตัวเลือกในฟอร์มไม่มีอยู่
 *      = แก้ไม่ได้/บันทึกทับไม่ได้ และผู้ใช้จะไม่รู้สาเหตุ · ทางเลือกคือ *ไม่บล็อกแล้วเตือน* ซึ่ง UI ทำไม่ได้
 *      ถ้าชั้นข้อมูลไม่ส่งสัญญาณ — จึงเลือกบล็อกพร้อมข้อความ actionable
 *   3. ตรวจทุกอย่างใน 1 query (join accounts/categories มาดู archived_at) แล้วค่อย update
 */
export async function restoreTransaction(db: Db, session: Session, id: string): Promise<TxnRow> {
  const rowId = requiredText(id, 'id ของรายการ');
  const toAccounts = alias(accounts, 'to_accounts');

  const rows = await guardWrite(() =>
    db
      .select({
        ...TXN_COLUMNS,
        accountArchivedAt: accounts.archivedAt,
        toAccountArchivedAt: toAccounts.archivedAt,
        categoryArchivedAt: categories.archivedAt,
      })
      .from(transactions)
      .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.userId, transactions.userId)))
      .leftJoin(
        toAccounts,
        and(eq(toAccounts.id, transactions.toAccountId), eq(toAccounts.userId, transactions.userId)),
      )
      .leftJoin(
        categories,
        and(eq(categories.id, transactions.categoryId), eq(categories.userId, transactions.userId)),
      )
      .where(and(eq(transactions.id, rowId), eq(transactions.userId, session.userId)))
      .limit(1),
  );

  const before = rows[0] as (RestorableRow & (typeof rows)[number]) | undefined;
  if (!before) throw new ValidationError('ไม่พบรายการนี้ (หรือไม่ใช่ของคุณ)');
  if (before.deletedAt === null) throw new ValidationError('รายการนี้ไม่ได้ถูกลบอยู่');
  if (before.accountArchivedAt !== null) {
    throw new ValidationError('กู้คืนไม่ได้เพราะกระเป๋าของรายการนี้ถูกเลิกใช้แล้ว — กู้คืนกระเป๋าก่อน');
  }
  if (before.toAccountArchivedAt !== null) {
    throw new ValidationError('กู้คืนไม่ได้เพราะกระเป๋าปลายทางถูกเลิกใช้แล้ว — กู้คืนกระเป๋าก่อน');
  }
  if (before.categoryArchivedAt !== null) {
    throw new ValidationError('กู้คืนไม่ได้เพราะหมวดของรายการนี้ถูกเลิกใช้แล้ว — กู้คืนหมวดก่อน');
  }

  const updated = await guardWrite(() =>
    db
      .update(transactions)
      .set({ deletedAt: null })
      .where(ownDeletedRow(session, rowId))
      .returning(TXN_COLUMNS),
  );

  // แพ้การแข่ง: มีคนลบ/แก้พร้อมกันจนแถวไม่ใช่ "ที่ลบอยู่" อีกแล้ว → ต้องได้ ValidationError ไม่ใช่ undefined
  if (updated.length === 0) {
    throw new ValidationError('ไม่พบรายการที่ลบนี้ (อาจถูกกู้คืนไปแล้วหรือไม่ใช่ของคุณ)');
  }
  return toRows(updated)[0];
}
