/**
 * อ่านกระเป๋าเงิน (accounts) — ชั้นอ่านเท่านั้น ไม่มีสูตรเงิน
 *
 * ต่างจาก transactions: ตารางนี้เลิกใช้ = archived_at (ไม่ใช่ deleted_at)
 * active = archived_at is null — ห้ามคัดลอก liveOf() ของ transactions มาทั้งดุ้น
 */
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { Db } from '../index.ts';
import { accounts } from '../schema.ts';

/** ชนิดกระเป๋าตาม check ของ DB (accounts_kind_check) */
export const ACCOUNT_KINDS = ['cash', 'bank', 'credit', 'ewallet', 'other'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** คอลัมน์มาตรฐานของกระเป๋า — ใช้ร่วมกับ write path (src/db/mutations/accounts.ts) */
export const ACCOUNT_COLUMNS = {
  id: accounts.id,
  name: accounts.name,
  kind: accounts.kind,
  initialBalance: accounts.initialBalance,
  icon: accounts.icon,
  color: accounts.color,
  archivedAt: accounts.archivedAt,
};

export type AccountRow = {
  id: string;
  name: string;
  kind: string;
  initialBalance: number;
  icon: string | null;
  color: string | null;
  archivedAt: Date | null;
};

/** กระเป๋าที่ยังใช้งาน เรียงตามลำดับที่สร้าง (ผู้ใช้เห็นลำดับเดิมทุกครั้ง) */
export async function listAccounts(db: Db, userId: string): Promise<AccountRow[]> {
  return db
    .select(ACCOUNT_COLUMNS)
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.createdAt));
}
