/**
 * อ่าน "สถานะผู้ใช้" แบบภาพรวม (ข้ามตาราง) — ไม่เกี่ยวกับยอดเงินจึงไม่มีสูตรเงินในไฟล์นี้
 *
 * ทำไมต้องมี: หน้า onboarding ต้องรู้ว่า "ผู้ใช้ใหม่จริงไหม" เพื่อเลือกข้อความ/ปุ่มที่ถูก
 * โดย**ไม่เพิ่มคอลัมน์ธงใน DB และไม่ต้อง migration** — ตัดสินจากข้อมูลที่มีอยู่จริง ณ ตอนอ่าน
 * (ธงใน DB จะเพี้ยนทันทีที่มีคนลบ/archive ของเดิม หรือย้ายข้อมูล)
 *
 * relative import + .ts ต่อท้าย เพราะเทสต์รันด้วย `node --test` ตรง ๆ ซึ่งไม่รู้จัก alias @/
 */
import { eq, sql } from 'drizzle-orm';

import type { Db } from '../index.ts';
import { accounts, categories, transactions, user } from '../schema.ts';

export type FirstRunState = {
  /** มีกระเป๋าอย่างน้อย 1 ใบ (นับที่ archive แล้วด้วย — ผู้ใช้ที่เลิกใช้ของเดิมไปหมดก็ไม่ใช่คนใหม่) */
  hasAccounts: boolean;
  /** มีหมวดอย่างน้อย 1 หมวด (นับที่ archive แล้วด้วย เหตุผลเดียวกับ hasAccounts) */
  hasCategories: boolean;
  /** มีรายการที่ **ยังไม่ถูกลบ** อย่างน้อย 1 รายการ (soft delete แล้วไม่นับ) */
  hasTransactions: boolean;
};

/**
 * สถานะผู้ใช้ใหม่ — **1 query** (สาม `exists(...)` ย่อยใน select เดียว)
 *
 * กติกาที่เลือก: `hasTransactions` นับเฉพาะ `deleted_at is null` เพราะผู้ใช้ที่ลบรายการทดลองทั้งหมดทิ้ง
 * ควรเห็นสถานะ "ยังไม่มีรายการ" อีกครั้ง · ส่วนกระเป๋า/หมวด **นับของที่ archive แล้ว** เพราะการ archive
 * แปลว่า "เคยตั้งค่าไว้" ไม่ใช่ "เพิ่งเริ่มใช้" (ถ้านับแบบไม่รวม ผู้ใช้ที่ archive กระเป๋าใบเดียวจะกลับไป
 * เห็น onboarding อีกครั้งทั้งที่ข้อมูลยังอยู่)
 *
 * อ่านจากตาราง `user` เป็นตัวตั้ง (ผู้ใช้ที่ล็อกอินมีแถวอยู่แล้วเสมอ) → ได้ 1 แถวเสมอแม้ผู้ใช้ไม่มีข้อมูลอะไรเลย
 * (ถ้าใช้ accounts เป็นตัวตั้ง ผู้ใช้ใหม่จะได้ 0 แถว และแยกไม่ออกระหว่าง "ไม่มีอะไรเลย" กับ "อ่านไม่เจอ")
 * userId ที่ไม่มีในตาราง user = คืน false ทั้งสาม ไม่ throw
 */
export async function firstRunState(db: Db, userId: string): Promise<FirstRunState> {
  const rows = await db
    .select({
      hasAccounts: sql<boolean>`exists (select 1 from ${accounts} where ${accounts.userId} = ${userId})`,
      hasCategories: sql<boolean>`exists (select 1 from ${categories} where ${categories.userId} = ${userId})`,
      hasTransactions: sql<boolean>`exists (select 1 from ${transactions}
        where ${transactions.userId} = ${userId} and ${transactions.deletedAt} is null)`,
    })
    .from(user)
    .where(eq(user.id, userId));

  const row = rows[0];
  return {
    hasAccounts: row?.hasAccounts ?? false,
    hasCategories: row?.hasCategories ?? false,
    hasTransactions: row?.hasTransactions ?? false,
  };
}
