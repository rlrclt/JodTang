/**
 * Write path ของกระเป๋าเงิน (accounts) — เพิ่ม/แก้/archive
 *
 * กติกาของไฟล์นี้ (docs/schema.sql):
 *   1. userId มาจาก session เท่านั้น — input ที่ส่ง userId/id/archivedAt/currency เข้ามาถูกปฏิเสธ
 *   2. validate ก่อนยิง SQL เท่าที่ตรวจแบบ sync ได้: name btrim <> '' · kind ตาม accounts_kind_check ·
 *      initial_balance เป็นสตางค์จำนวนเต็ม (ติดลบได้ = บัตรเครดิต) ช่วง ±1e15 · currency ล็อก THB
 *      ชื่อซ้ำ (unique partial index accounts_user_name_uidx) กับ check ของ DB → toUserError() แปลเป็นข้อความไทย
 *   3. archive = ตั้ง archived_at (ห้าม DELETE) — กระเป๋าที่ archive แล้วหายจากลิสต์ active แต่รายการเก่ายังอ้างได้
 *   4. ห้ามคำนวณเงินในชั้นนี้ (ไม่มีสูตร/ผลรวม) — ยอดคิดที่ src/lib/money.ts
 *   5. ทุก statement ผูกด้วย userId ของ session (eq(accounts.userId, …))
 *
 * หมายเหตุ: active ของตารางนี้คือ archived_at is null — คนละกติกากับ transactions (deleted_at)
 * จึงใช้ ownActiveAccount() ของไฟล์นี้ ไม่ใช่ liveOf() ของ transactions
 */
import { and, eq, isNull } from 'drizzle-orm';

import { toSatang } from '../../lib/money.ts';
import { guardWrite, ValidationError } from '../errors.ts';
import type { Db } from '../index.ts';
import { ACCOUNT_COLUMNS, ACCOUNT_KINDS, type AccountKind, type AccountRow } from '../queries/accounts.ts';
import { accounts } from '../schema.ts';
import type { Session } from '../session.ts';

/** สตางค์เพดานเดียวกับ DB (accounts_initial_balance_check: > -1e15 และ < 1e15) */
const MAX_BALANCE = 1_000_000_000_000_000;
const CURRENCY = 'THB';
/** ฟิลด์ที่ยอมรับจาก input — ที่ไม่อยู่ในลิสต์ (userId, id, archivedAt, currency, …) = ปฏิเสธ */
const ALLOWED_KEYS: readonly string[] = ['name', 'kind', 'initialBalance', 'icon', 'color'];

export type ValidAccount = {
  name: string;
  kind: AccountKind;
  /** สตางค์ · ติดลบได้ (= ยอดค้างจ่ายของบัตรเครดิต) */
  initialBalance: number;
  icon: string | null;
  color: string | null;
};

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ValidationError(`ต้องระบุ${field}`);
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError(`${field}ต้องเป็นข้อความ`);
  return value;
}

/** ตรวจกติกาทั้งชุดของกระเป๋า (ใช้ทั้งตอนเพิ่มและตอนแก้ — ตอนแก้ประกอบร่างใหม่ก่อนแล้วเรียกตัวเดียวกัน) */
export function validateAccount(input: unknown): ValidAccount {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('ข้อมูลกระเป๋าต้องเป็น object');
  }
  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new ValidationError(`ไม่อนุญาตให้ส่งฟิลด์ ${key} (userId มาจาก session เท่านั้น)`);
    }
  }

  // เก็บชื่อแบบตัดช่องว่างหัวท้าย (DB บังคับ btrim(name) <> '' และ unique คิดแบบ lower(btrim(name)))
  const name = requiredText(raw.name, 'ชื่อกระเป๋า').trim();
  if (name === '') throw new ValidationError('ต้องระบุชื่อกระเป๋า');

  // ไม่ส่ง kind = 'cash' (accounts.kind not null default 'cash' ใน DB) — ส่งมาแล้วต้องอยู่ในลิสต์ของ check
  const kind = raw.kind ?? 'cash';
  if (typeof kind !== 'string' || !ACCOUNT_KINDS.includes(kind as AccountKind)) {
    throw new ValidationError('kind ต้องเป็น cash, bank, credit, ewallet หรือ other');
  }

  let initialBalance: number;
  try {
    // toSatang = ด่านตรวจชนิดของเงิน (สตริง/BigInt/ทศนิยม throw) — ที่นี่ไม่บวกอะไรทั้งสิ้น
    initialBalance = toSatang(raw.initialBalance ?? 0, 'ยอดตั้งต้น');
  } catch (error) {
    throw new ValidationError((error as Error).message);
  }
  if (initialBalance <= -MAX_BALANCE || initialBalance >= MAX_BALANCE) {
    throw new ValidationError('ยอดตั้งต้นเกินช่วงที่ระบบรองรับ');
  }

  return {
    name,
    kind: kind as AccountKind,
    initialBalance,
    icon: optionalText(raw.icon, 'ไอคอน'),
    color: optionalText(raw.color, 'สี'),
  };
}

/** ฟิลด์ที่แก้ได้ (kind เปลี่ยนได้ — DB ไม่ได้ผูก kind ของกระเป๋ากับรายการ จึงไม่ทำรายการเก่าพัง) */
export type AccountPatch = Partial<ValidAccount>;

/** แถวที่ยังใช้งานของผู้ใช้คนนี้เท่านั้น (active = archived_at is null) */
const ownActiveAccount = (session: Session, id: string) =>
  and(eq(accounts.id, id), eq(accounts.userId, session.userId), isNull(accounts.archivedAt));

/** เพิ่มกระเป๋า — userId มาจาก session ไม่ใช่จาก input */
export async function addAccount(db: Db, session: Session, input: unknown): Promise<AccountRow> {
  const data = validateAccount(input);

  const rows = await guardWrite(() =>
    db
      .insert(accounts)
      .values({
        userId: session.userId,
        name: data.name,
        kind: data.kind,
        currency: CURRENCY,
        initialBalance: data.initialBalance,
        icon: data.icon,
        color: data.color,
      })
      .returning(ACCOUNT_COLUMNS),
  );

  return rows[0];
}

/** แก้กระเป๋า: อ่านของเดิม (ของ session นี้ ยังไม่ archive) → ประกอบร่างใหม่ → validate ชุดเดิม → update */
export async function updateAccount(
  db: Db,
  session: Session,
  id: string,
  patch: unknown,
): Promise<AccountRow> {
  const rowId = requiredText(id, 'id ของกระเป๋า');
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new ValidationError('ข้อมูลที่แก้ต้องเป็น object');
  }

  const current = await guardWrite(() =>
    db.select(ACCOUNT_COLUMNS).from(accounts).where(ownActiveAccount(session, rowId)),
  );
  if (current.length === 0) throw new ValidationError('ไม่พบกระเป๋านี้ (อาจถูก archive ไปแล้วหรือไม่ใช่ของคุณ)');

  const before = current[0];
  // ประกอบร่างจาก "ฟิลด์ที่ยอมรับ" เท่านั้น (current มี id/archivedAt ที่ validate ต้องปฏิเสธ) แล้วทับด้วย patch
  const merged = validateAccount({
    name: before.name,
    kind: before.kind,
    initialBalance: before.initialBalance,
    icon: before.icon,
    color: before.color,
    ...(patch as Record<string, unknown>),
  });

  const rows = await guardWrite(() =>
    db
      .update(accounts)
      .set({
        name: merged.name,
        kind: merged.kind,
        initialBalance: merged.initialBalance,
        icon: merged.icon,
        color: merged.color,
      })
      .where(ownActiveAccount(session, rowId))
      .returning(ACCOUNT_COLUMNS),
  );

  // แพ้การแข่ง: แถวถูก archive/หายไประหว่างอ่านกับเขียน → ต้องได้ ValidationError ไม่ใช่ undefined
  if (rows.length === 0) {
    throw new ValidationError('ไม่พบกระเป๋านี้ (อาจถูก archive ไปแล้วหรือไม่ใช่ของคุณ)');
  }
  return rows[0];
}

/** archive กระเป๋า = ตั้ง archived_at (ไม่มี DELETE จริงในชั้นนี้) */
export async function archiveAccount(db: Db, session: Session, id: string): Promise<{ id: string }> {
  const rowId = requiredText(id, 'id ของกระเป๋า');

  const rows = await guardWrite(() =>
    db
      .update(accounts)
      .set({ archivedAt: new Date() })
      .where(ownActiveAccount(session, rowId))
      .returning({ id: accounts.id }),
  );

  if (rows.length === 0) {
    throw new ValidationError('ไม่พบกระเป๋านี้ (อาจถูก archive ไปแล้วหรือไม่ใช่ของคุณ)');
  }
  return rows[0];
}
