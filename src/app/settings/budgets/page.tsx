import Link from 'next/link';

import { LoadFailed } from '@/components/LoadFailed';
import { MonthSwitcher } from '@/components/MonthSwitcher';
import { RetryBar } from '@/components/RetryBar';
import { getDb } from '@/db';
import { listBudgetProgress } from '@/db/queries/budgets';
import { listCategories } from '@/db/queries/categories';
import { formatMonthLabelTh, periodMonthFromParam } from '@/lib/month';
import { isNextControlFlow } from '@/lib/next-signals';
import { gateSession } from '@/lib/session';

import type { BudgetItem } from './BudgetSheet';
import { BudgetList } from './BudgetList';

export const metadata = { title: 'งบประมาณ · จดจ่าย' };

/**
 * ตั้งงบต่อหมวด (ข้อเสนอ §2) — **เดือนที่เลือกจาก `?m`** (เหมือน /transactions และ /summary)
 * `periodMonthFromParam` ไม่ throw: ค่าจาก URL เพี้ยน = เดือนปัจจุบัน (หน้าไม่ 500 — spec §1)
 * รวม 2 แหล่ง: หมวดรายจ่ายที่ยังใช้อยู่ทั้งหมด (ตั้งได้) + งบของหมวดที่ถูก archive ไปแล้ว (ต้องเห็น ไม่ซ่อน)
 */
export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const gate = await gateSession();
  if (gate.unavailable) return <LoadFailed />;
  const { userId } = gate.user;
  const db = getDb();
  const periodMonth = periodMonthFromParam((await searchParams).m);
  const periodLabel = formatMonthLabelTh(periodMonth);

  let items: BudgetItem[] | null = null;
  try {
    const [categories, progress] = await Promise.all([
      listCategories(db, userId, 'expense'),
      listBudgetProgress(db, userId, periodMonth),
    ]);

    const byCategory: Record<string, BudgetItem> = {};
    for (const category of categories) {
      byCategory[category.id] = {
        categoryId: category.id,
        name: category.name,
        color: category.color,
        archived: false,
        budgetId: null,
        amount: null,
      };
    }
    for (const row of progress) {
      byCategory[row.categoryId] = {
        categoryId: row.categoryId,
        name: row.categoryName,
        color: row.categoryColor,
        archived: row.categoryArchivedAt !== null,
        budgetId: row.budgetId,
        amount: row.amount,
      };
    }
    items = Object.values(byCategory);
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // สัญญาณ prerender ของ Next — ห้ามกลืน
    // ตัวเลขที่โหลดไม่ได้ต้องไม่ล้มทั้งหน้า: บอกเป็นแถบ + ปุ่มลองใหม่ (design §4)
    console.error('[jodjai] โหลดงบประมาณไม่สำเร็จ:', error);
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
        <h1 className="text-2xl font-semibold">งบประมาณ</h1>
      </header>

      <MonthSwitcher basePath="/settings/budgets" periodMonth={periodMonth} />

      <p className="text-[13px] leading-[18px] text-text-muted">
        งบเป็นรายเดือน ต่อหมวด · ตั้งล่วงหน้า/ย้อนหลังได้ · เดือนใหม่ต้องตั้งใหม่ (ไม่พกยอดที่เหลือ)
      </p>

      {items ? (
        <BudgetList items={items} periodMonth={periodMonth} periodLabel={periodLabel} />
      ) : (
        <RetryBar message="โหลดงบไม่สำเร็จ" />
      )}

      <p className="text-[13px] leading-[18px] text-text-muted">
        ยอดที่ใช้ไปคิดจากรายการจริงของเดือนที่เลือก และดูได้ที่หน้าสรุป
      </p>
    </div>
  );
}
