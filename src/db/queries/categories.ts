/**
 * อ่านหมวด (categories) — ชั้นอ่านเท่านั้น
 *
 * ต่างจาก transactions: ตารางนี้เลิกใช้ = archived_at (ไม่ใช่ deleted_at)
 * active = archived_at is null — ห้ามคัดลอก liveOf() ของ transactions มาทั้งดุ้น
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import type { Db } from '../index.ts';
import { categories, transactions } from '../schema.ts';

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
 * query ของ "หมวดที่ควรเสนอ" — แยก builder ให้เทสต์ EXPLAIN ตรวจได้ (ตัวเดียวกับที่ suggestedCategoryId รันจริง)
 * join กับ categories เพื่อ (ก) ยืนยันว่าเป็นหมวดของผู้ใช้คนนี้ (ข) ตัดหมวดที่ archive แล้วออก
 */
export function suggestedCategoryQuery(db: Db, userId: string, kind: CategoryKind) {
  return db
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .innerJoin(
      categories,
      and(
        eq(categories.id, transactions.categoryId),
        eq(categories.userId, transactions.userId),
        isNull(categories.archivedAt),
      ),
    )
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.kind, kind),
        isNull(transactions.deletedAt),
        isNotNull(transactions.categoryId),
      ),
    )
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(1);
}

/**
 * หมวดที่ควรเสนอตอนเปิดชีตบันทึกรายการ (โฟลว์ 2 แตะ) = หมวดของรายการล่าสุดของ kind นั้น · **1 query**
 *
 * กติกาที่เลือก (spec wave10b §2):
 *   - ใช้เฉพาะแถวที่ยังไม่ถูกลบ (`deleted_at is null`) และหมวดต้องเป็นของผู้ใช้คนนี้และ **ยังไม่ถูก archive**
 *     → ถ้าหมวดของแถวล่าสุดถูก archive ไปแล้ว จะ "ข้ามไปแถวก่อนหน้า" ที่หมวดยังใช้ได้ (ค่าเริ่มต้นต้องเลือกได้จริงในฟอร์ม)
 *   - kind อื่นไม่เกี่ยว (รับ vs จ่ายมีคนละชุดหมวด) · ของผู้ใช้คนอื่นไม่หลุด
 *   - ไม่มีรายการที่ใช้ได้เลย = `null` — UI fallback ไปหมวดแรกของ kind เอง (ไม่ทำ fallback ที่ชั้นข้อมูล)
 * เรียง `occurred_at desc, id desc` (id เป็นตัวตัดสินเวลาเท่ากัน เหมือน keyset ของรายการ) ใช้ index `transactions_user_kind_time_idx`
 */
export async function suggestedCategoryId(
  db: Db,
  userId: string,
  kind: CategoryKind,
): Promise<string | null> {
  const rows = await suggestedCategoryQuery(db, userId, kind);
  // category_id เป็น null ไม่ได้เมื่อ kind เป็น income/expense (transactions_shape_ck) — join จึงทำให้ไม่เป็น null อยู่แล้ว
  return rows[0]?.categoryId ?? null;
}

/**
 * จำนวน "รายการที่ยังไม่ถูกลบ" ที่อ้างถึงหมวดแต่ละอัน — **1 query** (ไม่ใช่ query ต่อหมวด)
 * ใช้ตอนเตือนก่อน archive ("ยังมี N รายการอ้างถึง") · คืนเฉพาะ id ที่มีอย่างน้อย 1 รายการ
 * (ผู้เรียกอ่าน `usage.get(id) ?? 0`) · ids ว่าง = ไม่ยิง DB · หมวดของผู้ใช้คนอื่นไม่หลุด (กรอง user_id)
 */
export async function categoryUsage(
  db: Db,
  userId: string,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();

  const rows = await db
    .select({ categoryId: transactions.categoryId, total: sql<unknown>`count(*)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        inArray(transactions.categoryId, wanted),
      ),
    )
    .groupBy(transactions.categoryId);

  const usage = new Map<string, number>();
  for (const row of rows) {
    if (row.categoryId !== null) usage.set(row.categoryId, Number(row.total));
  }
  return usage;
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
