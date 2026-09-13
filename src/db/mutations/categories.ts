/**
 * Write path ของหมวด (categories) — เพิ่ม/แก้/archive
 *
 * กติกาของไฟล์นี้ (docs/schema.sql):
 *   1. userId มาจาก session เท่านั้น — input ที่ส่ง userId/id/archivedAt เข้ามาถูกปฏิเสธ
 *   2. validate ก่อนยิง SQL เท่าที่ตรวจแบบ sync ได้: name btrim <> '' · kind in (income, expense)
 *      ชื่อซ้ำในทิศทางเดียวกัน (unique partial index categories_user_kind_name_uidx) กับ check ของ DB
 *      → toUserError() แปลเป็นข้อความไทย (23505 = 'มีชื่อนี้อยู่แล้ว')
 *   3. archive = ตั้ง archived_at (ห้าม DELETE) — หมวดที่ archive แล้วหายจากลิสต์ active แต่รายการเก่ายังอ้างได้
 *   4. ห้ามคำนวณเงินในชั้นนี้
 *   5. ทุก statement ผูกด้วย userId ของ session (eq(categories.userId, …))
 *
 * หมายเหตุ 1: active ของตารางนี้คือ archived_at is null — คนละกติกากับ transactions (deleted_at)
 * หมายเหตุ 2: เปลี่ยน kind ของหมวดไม่ได้ เพราะ transactions อ้าง (category_id, kind, user_id)
 *   ผ่าน composite FK — เปลี่ยนแล้วรายการเก่าพัง (จะได้ 23503 ที่อ่านไม่รู้เรื่อง) จึงปฏิเสธที่ชั้นนี้พร้อมข้อความที่เข้าใจได้
 */
import { and, eq, isNull } from 'drizzle-orm';

import { guardWrite, ValidationError } from '../errors.ts';
import type { Db } from '../index.ts';
import {
  CATEGORY_COLUMNS,
  CATEGORY_KINDS,
  type CategoryKind,
  type CategoryRow,
} from '../queries/categories.ts';
import { categories } from '../schema.ts';
import type { Session } from '../session.ts';

/** ฟิลด์ที่ยอมรับจาก input — ที่ไม่อยู่ในลิสต์ (userId, id, kind ตอนแก้, archivedAt) = ปฏิเสธ */
const ALLOWED_KEYS: readonly string[] = ['kind', 'name', 'icon', 'color', 'sortOrder'];

export type ValidCategory = {
  kind: CategoryKind;
  name: string;
  icon: string | null;
  color: string | null;
  /** ลำดับที่ผู้ใช้จัดในหน้าตั้งค่า (น้อยไปมาก) */
  sortOrder: number;
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

/** ตรวจกติกาทั้งชุดของหมวด (ใช้ทั้งตอนเพิ่มและตอนแก้ — ตอนแก้ประกอบร่างใหม่ก่อนแล้วเรียกตัวเดียวกัน) */
export function validateCategory(input: unknown): ValidCategory {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('ข้อมูลหมวดต้องเป็น object');
  }
  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new ValidationError(`ไม่อนุญาตให้ส่งฟิลด์ ${key} (userId มาจาก session เท่านั้น)`);
    }
  }

  const { kind } = raw;
  if (typeof kind !== 'string' || !CATEGORY_KINDS.includes(kind as CategoryKind)) {
    throw new ValidationError('kind ต้องเป็น income หรือ expense');
  }

  // เก็บชื่อแบบตัดช่องว่างหัวท้าย (DB บังคับ btrim(name) <> '' และ unique คิดแบบ lower(btrim(name)))
  const name = requiredText(raw.name, 'ชื่อหมวด').trim();
  if (name === '') throw new ValidationError('ต้องระบุชื่อหมวด');

  let sortOrder = 0;
  if (raw.sortOrder != null) {
    if (typeof raw.sortOrder !== 'number' || !Number.isSafeInteger(raw.sortOrder)) {
      throw new ValidationError('ลำดับต้องเป็นจำนวนเต็ม');
    }
    sortOrder = raw.sortOrder;
  }

  return {
    kind: kind as CategoryKind,
    name,
    icon: optionalText(raw.icon, 'ไอคอน'),
    color: optionalText(raw.color, 'สี'),
    sortOrder,
  };
}

/** ฟิลด์ที่แก้ได้ (kind เปลี่ยนไม่ได้ — ดูหมายเหตุ 2 หัวไฟล์) */
export type CategoryPatch = Partial<Omit<ValidCategory, 'kind'>>;

/** แถวที่ยังใช้งานของผู้ใช้คนนี้เท่านั้น (active = archived_at is null) */
const ownActiveCategory = (session: Session, id: string) =>
  and(eq(categories.id, id), eq(categories.userId, session.userId), isNull(categories.archivedAt));

/** เพิ่มหมวด — userId มาจาก session ไม่ใช่จาก input */
export async function addCategory(db: Db, session: Session, input: unknown): Promise<CategoryRow> {
  const data = validateCategory(input);

  const rows = await guardWrite(() =>
    db
      .insert(categories)
      .values({
        userId: session.userId,
        kind: data.kind,
        name: data.name,
        icon: data.icon,
        color: data.color,
        sortOrder: data.sortOrder,
      })
      .returning(CATEGORY_COLUMNS),
  );

  return rows[0];
}

/** แก้หมวด: อ่านของเดิม (ของ session นี้ ยังไม่ archive) → ประกอบร่างใหม่ → validate ชุดเดิม → update */
export async function updateCategory(
  db: Db,
  session: Session,
  id: string,
  patch: unknown,
): Promise<CategoryRow> {
  const rowId = requiredText(id, 'id ของหมวด');
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new ValidationError('ข้อมูลที่แก้ต้องเป็น object');
  }
  if ('kind' in (patch as Record<string, unknown>)) {
    throw new ValidationError('เปลี่ยนประเภทหมวดไม่ได้ — ให้ archive แล้วสร้างใหม่');
  }

  const current = await guardWrite(() =>
    db.select(CATEGORY_COLUMNS).from(categories).where(ownActiveCategory(session, rowId)),
  );
  if (current.length === 0) throw new ValidationError('ไม่พบหมวดนี้ (อาจถูก archive ไปแล้วหรือไม่ใช่ของคุณ)');

  const before = current[0];
  // ประกอบร่างจาก "ฟิลด์ที่ยอมรับ" เท่านั้น (current มี id/archivedAt ที่ validate ต้องปฏิเสธ) แล้วทับด้วย patch
  const merged = validateCategory({
    kind: before.kind,
    name: before.name,
    icon: before.icon,
    color: before.color,
    sortOrder: before.sortOrder,
    ...(patch as Record<string, unknown>),
  });

  const rows = await guardWrite(() =>
    db
      .update(categories)
      .set({
        name: merged.name,
        icon: merged.icon,
        color: merged.color,
        sortOrder: merged.sortOrder,
      })
      .where(ownActiveCategory(session, rowId))
      .returning(CATEGORY_COLUMNS),
  );

  // แพ้การแข่ง: แถวถูก archive/หายไประหว่างอ่านกับเขียน → ValidationError ไม่ใช่ undefined
  if (rows.length === 0) {
    throw new ValidationError('ไม่พบหมวดนี้ (อาจถูก archive ไปแล้วหรือไม่ใช่ของคุณ)');
  }
  return rows[0];
}

/** archive หมวด = ตั้ง archived_at (ไม่มี DELETE จริงในชั้นนี้) */
export async function archiveCategory(db: Db, session: Session, id: string): Promise<{ id: string }> {
  const rowId = requiredText(id, 'id ของหมวด');

  const rows = await guardWrite(() =>
    db
      .update(categories)
      .set({ archivedAt: new Date() })
      .where(ownActiveCategory(session, rowId))
      .returning({ id: categories.id }),
  );

  if (rows.length === 0) {
    throw new ValidationError('ไม่พบหมวดนี้ (อาจถูก archive ไปแล้วหรือไม่ใช่ของคุณ)');
  }
  return rows[0];
}
