import Link from 'next/link';
import { Suspense } from 'react';

import { BudgetRow, BudgetSkeleton } from '@/components/BudgetProgress';
import { LoadFailed } from '@/components/LoadFailed';
import { RetryBar } from '@/components/RetryBar';
import { getDb } from '@/db';
import { listBudgetProgress } from '@/db/queries/budgets';
import { TREND, TRANSACTIONS, categoryOf } from '@/lib/fixtures';
import { type PeriodMonth, formatMonthLabelTh, periodMonthOfBkk } from '@/lib/month';
import { expenseByCategory, formatSatang, periodTotals } from '@/lib/money';
import { isNextControlFlow } from '@/lib/next-signals';
import { gateSession } from '@/lib/session';

/**
 * บล็อกเทียบงบ — query ของตัวเองแล้วสตรีมเข้ามาด้วย Suspense (ข้อเสนอ §3)
 * ถ้าโหลดงบไม่สำเร็จ หน้าอื่นต้องไม่พัง: บล็อกนี้กลายเป็นแถบ + ปุ่มลองใหม่ (ตัวเลขสำคัญกว่ากราฟ)
 */
async function BudgetSection({ userId, periodMonth }: { userId: string; periodMonth: PeriodMonth }) {
  let rows;
  try {
    rows = await listBudgetProgress(getDb(), userId, periodMonth);
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // สัญญาณ prerender ของ Next — ห้ามกลืน
    console.error('[jodjai] โหลดงบประมาณไม่สำเร็จ:', error);
    return <RetryBar message="โหลดงบไม่สำเร็จ" />;
  }

  if (rows.length === 0) {
    return (
      <div className="mt-1 flex flex-col gap-1">
        <p className="text-text-muted">เดือนนี้ยังไม่ได้ตั้งงบ</p>
        <Link
          href="/settings/budgets"
          className="flex min-h-11 items-center font-semibold text-[var(--balance)]"
        >
          ไปตั้งงบที่หน้าตั้งค่า ›
        </Link>
      </div>
    );
  }

  return (
    <ul className="mt-1">
      {rows.map((row) => (
        <BudgetRow key={row.budgetId} row={row} />
      ))}
    </ul>
  );
}

/**
 * S5 สรุป (design.md §4 S5) — กราฟทำด้วย div + CSS ล้วน ไม่ใส่ไลบรารี (§7)
 * ยอดทุกตัวมาจาก src/lib/money.ts · กราฟห้ามใช้เฉดเขียว (§1.1) จึงใช้ --expense/ชุดกราฟตามที่กำหนด
 * รอบนี้: บล็อกเทียบงบใช้ข้อมูลจริง (listBudgetProgress) · แนวโน้ม/กราฟหมวดยังใช้ fixtures (งานถัดไป)
 */
export default async function SummaryPage() {
  const gate = await gateSession();
  if (gate.unavailable) return <LoadFailed />;
  const { userId } = gate.user;
  const periodMonth = periodMonthOfBkk();
  const totals = periodTotals(TRANSACTIONS);
  const byCategory = expenseByCategory(TRANSACTIONS);
  const maxTrend = Math.max(...TREND.map((point) => point.amount));

  const categories = [...byCategory.entries()]
    .map(([id, amount]) => ({ category: categoryOf(id), amount }))
    .sort((a, b) => b.amount - a.amount);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex min-h-11 items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">สรุป</h1>
        <p className="text-[13px] leading-[18px] text-text-muted">{formatMonthLabelTh(periodMonth)}</p>
      </header>

      <section aria-labelledby="trend-label" className="rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-2">
          <h2 id="trend-label" className="text-xl font-semibold">
            รายจ่าย 6 เดือน
          </h2>
          <span className="num text-text-muted">{formatSatang(TREND.reduce((sum, point) => sum + point.amount, 0))}</span>
        </div>
        <div className="mt-2 flex h-36 items-end gap-2">
          {TREND.map((point) => {
            const current = point.month === 'ก.ย.';
            return (
              <div key={point.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <div
                  role="img"
                  aria-label={`${point.month} รายจ่าย ${formatSatang(point.amount)}`}
                  style={{ height: `${(point.amount / maxTrend) * 100}%` }}
                  className="w-full rounded-t-[8px] border border-expense bg-expense"
                />
                <span className={`text-[13px] leading-[18px] ${current ? 'font-semibold text-text' : 'text-text-muted'}`}>
                  {point.month}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="cat-label" className="rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-2">
          <h2 id="cat-label" className="text-xl font-semibold">
            รายจ่ายตามหมวด
          </h2>
          <span className="num text-text-muted">{formatSatang(totals.expense)}</span>
        </div>
        <ul className="mt-1">
          {categories.map(({ category, amount }) => (
            <li key={category?.id ?? 'unknown'} className="flex min-h-11 items-center gap-3">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-pill"
                style={{ background: category ? `var(${category.color})` : 'var(--balance)' }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{category?.name ?? 'อื่น ๆ'}</span>
                <span className="block text-[13px] leading-[18px] text-text-muted">
                  {totals.expense > 0 ? ((amount / totals.expense) * 100).toFixed(1) : '0.0'}% ของรายจ่าย
                </span>
              </span>
              <span className="num font-semibold">{formatSatang(amount)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="budget-label" className="rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-2">
          <h2 id="budget-label" className="text-xl font-semibold">
            เทียบงบ
          </h2>
          <span className="text-[13px] leading-[18px] text-text-muted">งบเดือนนี้</span>
        </div>
        <Suspense fallback={<BudgetSkeleton rows={3} />}>
          <BudgetSection userId={userId} periodMonth={periodMonth} />
        </Suspense>
      </section>
    </div>
  );
}
