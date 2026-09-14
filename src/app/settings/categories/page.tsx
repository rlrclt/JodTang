import Link from 'next/link';

import { LoadFailed } from '@/components/LoadFailed';
import { RetryBar } from '@/components/RetryBar';
import { getDb } from '@/db';
import { categoryUsage, listCategories } from '@/db/queries/categories';
import { isNextControlFlow } from '@/lib/next-signals';
import { gateSession } from '@/lib/session';

import { CategoryList } from './CategoryList';
import type { CategoryItem } from './CategorySheet';
import { logServer } from '@/lib/log';

export const metadata = { title: 'หมวดหมู่ · จดจ่าย' };

/**
 * จัดการหมวดหมู่ (spec §1, §2) — เห็นทั้งหมวดที่ยังใช้งานและที่เลิกใช้แล้ว (ต้องกู้คืนได้)
 * usage ต่อแถวมาจาก categoryUsage (1 query) เพื่อให้ผู้ใช้ตัดสินใจตอนเลิกใช้ได้จริง
 */
export default async function CategoriesPage() {
  const gate = await gateSession();
  if (gate.unavailable) return <LoadFailed />;
  const { userId } = gate.user;

  let items: CategoryItem[] | null = null;
  try {
    const db = getDb();
    const rows = await listCategories(db, userId, undefined, { includeArchived: true });
    const usage = await categoryUsage(
      db,
      userId,
      rows.map((row) => row.id),
    );
    items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      // DB บังคับ kind in ('income','expense') ด้วย check constraint — แคบชนิดที่ขอบนี้ ไม่ cast
      kind: row.kind === 'income' ? 'income' : 'expense',
      color: row.color,
      archived: row.archivedAt !== null,
      usage: usage.get(row.id) ?? 0,
    }));
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // สัญญาณ prerender ของ Next — ห้ามกลืน
    logServer('categories.load_failed', { error, route: '/settings/categories' });
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex min-h-11 items-center gap-1">
        <Link
          href="/settings"
          aria-label="กลับไปหน้าตั้งค่า"
          className="flex size-11 shrink-0 items-center justify-center rounded-input text-text-muted"
        >
          <svg className="size-5" aria-hidden="true">
            <use href="#i-chevron-left" />
          </svg>
        </Link>
        <h1 className="text-2xl font-semibold">หมวดหมู่</h1>
      </header>

      <p className="text-[13px] leading-[18px] text-text-muted">
        หมวดใช้จัดรายรับ/รายจ่าย · เลิกใช้แล้วรายการเก่ายังอยู่ครบและยังนับในยอด
      </p>

      {items ? <CategoryList items={items} /> : <RetryBar message="โหลดหมวดไม่สำเร็จ" />}
    </div>
  );
}
