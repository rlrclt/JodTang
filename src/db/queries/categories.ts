/**
 * อ่านหมวด (categories) — ชั้นอ่านเท่านั้น
 *
 * ต่างจาก transactions: ตารางนี้เลิกใช้ = archived_at (ไม่ใช่ deleted_at)
 * active = archived_at is null — ห้ามคัดลอก liveOf() ของ transactions มาทั้งดุ้น
 */
import { and, asc, eq, isNull } from 'drizzle-orm';

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

/** หมวดที่ยังใช้งาน เรียงตามลำดับที่ผู้ใช้จัด (sort_order) แล้วชื่อ · ส่ง kind เพื่อกรองเฉพาะทิศทาง */
export async function listCategories(db: Db, userId: string, kind?: CategoryKind): Promise<CategoryRow[]> {
  const conditions = [eq(categories.userId, userId), isNull(categories.archivedAt)];
  if (kind) conditions.push(eq(categories.kind, kind));

  return db
    .select(CATEGORY_COLUMNS)
    .from(categories)
    .where(and(...conditions))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}
