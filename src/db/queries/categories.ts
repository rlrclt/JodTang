/**
 * อ่านหมวด (categories) — ชั้นอ่านเท่านั้น
 *
 * ต่างจาก transactions: ตารางนี้เลิกใช้ = archived_at (ไม่ใช่ deleted_at)
 * active = archived_at is null — ห้ามคัดลอก liveOf() ของ transactions มาทั้งดุ้น
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { Db } from '../index.ts';
import { categories } from '../schema.ts';

/** ชนิดหมวดตาม check ของ DB (categories_kind_check) — หมวดรับใช้กับรายจ่ายไม่ได้ (composite FK บังคับ) */
export const CATEGORY_KINDS = ['income', 'expense'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** คอลัมน์มาตรฐานของหมวด — ใช้ร่วมกับ write path (src/db/mutations/categories.ts) */
export const CATEGORY_COLUMNS = {
  id: categories.id,
  kind: categories.kind,
  name: categories.name,
  icon: categories.icon,
  color: categories.color,
  sortOrder: categories.sortOrder,
  archivedAt: categories.archivedAt,
};

export type CategoryRow = {
  id: string;
  kind: string;
  name: string;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  archivedAt: Date | null;
};

/** ตัวเลือกของ listCategories — ไม่ส่ง = พฤติกรรมเดิมเป๊ะ (เฉพาะหมวดที่ยังใช้งาน) */
export type ListCategoriesOptions = {
  /** true = คืนหมวดที่ archive แล้วด้วย (ต้องใช้เมื่อ UI ต้องเห็นของที่เลิกใช้ เช่นหน้าตั้งค่าที่มีปุ่มกู้คืน) */
  includeArchived?: boolean;
};

/**
 * หมวด เรียงตามลำดับที่ผู้ใช้จัด (sort_order) แล้วชื่อ · ส่ง kind เพื่อกรองเฉพาะทิศทาง
 * `options.includeArchived` ไม่ส่ง = เฉพาะที่ยังใช้งาน (พฤติกรรมเดิมของผู้เรียกทุกราย) · การเรียงลำดับไม่เปลี่ยน
 */
export async function listCategories(
  db: Db,
  userId: string,
  kind?: CategoryKind,
  options: ListCategoriesOptions = {},
): Promise<CategoryRow[]> {
  const conditions = [eq(categories.userId, userId)];
  if (!options.includeArchived) conditions.push(isNull(categories.archivedAt));
  if (kind) conditions.push(eq(categories.kind, kind));

  return db
    .select(CATEGORY_COLUMNS)
    .from(categories)
    .where(and(...conditions))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

/**
 * ชื่อ/ชนิด/สถานะของหมวดตามชุด id ที่ขอ — **1 query ต่อ 1 หน้า** (ห้าม N+1: อย่าเรียกต่อแถวรายการ)
 *
 * คืนหมวดที่ archive แล้วด้วยโดยตั้งใจ: รายการเก่ายังอ้างถึงหมวดที่เลิกใช้ ถ้าไม่คืน UI จะไม่มีชื่อให้แสดง
 * แล้วต้อง fallback ไปเขียนคำตาม kind แทน (ปิด minor 4e) · หมวดที่ไม่ใช่ของผู้ใช้คนนี้ไม่อยู่ในผลลัพธ์
 * `ids` ว่าง = คืน map ว่างโดยไม่ยิง DB
 */
export async function listCategoriesById(
  db: Db,
  userId: string,
  ids: readonly string[],
): Promise<Map<string, CategoryRow>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();

  const rows = await db
    .select(CATEGORY_COLUMNS)
    .from(categories)
    .where(and(eq(categories.userId, userId), inArray(categories.id, wanted)))
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  return new Map(rows.map((row): [string, CategoryRow] => [row.id, row]));
}
