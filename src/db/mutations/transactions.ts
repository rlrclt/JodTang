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
import { and, eq, isNull } from 'drizzle-orm';

import { toSatang } from '../../lib/money.ts';
import type { Db } from '../index.ts';
import { TXN_COLUMNS, toRows, type TxnRow } from '../queries/transactions.ts';
import { transactions } from '../schema.ts';

/** ผู้ทำรายการ — มาจาก session เท่านั้น (ห้ามประกอบจาก input) */
export type Session = { userId: string };

/** input ผิดกติกาของผู้ใช้ (ไม่ใช่บั๊ก) — server action ควรตอบเป็นข้อความให้ผู้ใช้ ไม่ใช่ 500 */
export class ValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ValidationError';
  }
}

/** รหัส error ของ PG ที่แปลเป็นข้อความผู้ใช้ (กฎข้อ 2 + design §4: ห้ามให้ SQL/ศัพท์เทคนิคถึงผู้ใช้) */
const DB_ERROR_MESSAGES: Record<string, string> = {
  '22P02': 'รูปแบบข้อมูลไม่ถูกต้อง', // uuid ผิดรูป ฯลฯ
  '23503': 'ไม่พบกระเป๋าเงินหรือหมวดที่อ้างถึง (หรือไม่ใช่ของผู้ใช้คนนี้)', // FK: ไม่มีอยู่/ข้ามผู้ใช้/kind ไม่ตรง
  '23514': 'ข้อมูลไม่ตรงกติกาของรายการ', // check ของ DB
};

/** SQLSTATE จาก error ของ drizzle/PGlite — มันซ้อนกันอยู่ที่ cause */
function pgCode(error: unknown): string | undefined {
  for (let node: unknown = error, depth = 0; node && depth < 4; depth++) {
    const code = (node as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    node = (node as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * แปล error ดิบของ DB → ValidationError ที่จุดเดียว (error เดิมคงไว้ที่ cause + log ไว้ debug)
 * รหัสที่ไม่รู้จัก = คืน error เดิม (บั๊กจริง/DB ล่ม ต้องเห็น stack ไม่ใช่กลายเป็นข้อความผู้ใช้)
 */
export function toUserError(error: unknown): unknown {
  const message = DB_ERROR_MESSAGES[pgCode(error) ?? ''];
  if (!message) return error;
  console.error('[jodjai] transaction write rejected by DB:', error);
  return new ValidationError(message, { cause: error });
}

/** รันคำสั่ง DB แล้วแปล error ที่ผู้ใช้ทำได้ (uuid/FK/check) ให้เป็นข้อความไทย */
async function guardWrite<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toUserError(error);
  }
}

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
    throw new ValidationError('ข้อมูลรายการต้องเป็น object');
  }
  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new ValidationError(`ไม่อนุญาตให้ส่งฟิลด์ ${key} (userId มาจาก session เท่านั้น)`);
    }
  }

  const { kind } = raw;
  if (typeof kind !== 'string' || !KINDS.includes(kind as TxnKindInput)) {
    throw new ValidationError('kind ต้องเป็น income, expense หรือ transfer');
  }

  let amount: number;
  try {
    amount = toSatang(raw.amount, 'จำนวนเงิน');
  } catch (error) {
    throw new ValidationError((error as Error).message);
  }
  if (amount <= 0) throw new ValidationError('จำนวนเงินต้องมากกว่า 0');
  if (amount >= MAX_SATANG) throw new ValidationError('จำนวนเงินเกินเพดานที่ระบบรองรับ');

  const accountId = requiredText(raw.accountId, 'กระเป๋าเงิน');
  const toAccountId = raw.toAccountId == null ? null : requiredText(raw.toAccountId, 'กระเป๋าปลายทาง');
  const categoryId = raw.categoryId == null ? null : requiredText(raw.categoryId, 'หมวด');

  if (raw.note != null && typeof raw.note !== 'string') throw new ValidationError('โน้ตต้องเป็นข้อความ');
  const note = typeof raw.note === 'string' ? raw.note : null;

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
    throw new ValidationError('ข้อมูลที่แก้ต้องเป็น object');
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
