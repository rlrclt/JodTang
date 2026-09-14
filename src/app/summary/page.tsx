import Link from 'next/link';
import { Suspense } from 'react';

import { BudgetRow, BudgetSkeleton } from '@/components/BudgetProgress';
import { LoadFailed } from '@/components/LoadFailed';
import { MonthSwitcher } from '@/components/MonthSwitcher';
import { RetryBar } from '@/components/RetryBar';
import { getDb } from '@/db';
import { listBudgetProgress } from '@/db/queries/budgets';
import { listCategoriesById } from '@/db/queries/categories';
import { monthExpenseByCategory, trendByMonth, type MonthTrend } from '@/db/queries/transactions';
import { type PeriodMonth, formatMonthLabelTh, periodMonthFromParam } from '@/lib/month';
import { withMonth } from '@/lib/month-url';
import { formatSatang } from '@/lib/money';
import { isNextControlFlow } from '@/lib/next-signals';
import { gateSession } from '@/lib/session';

/** ป้ายเดือนสั้นใต้แท่ง ('2026-09-01' → 'ก.ย.') — Intl เท่านั้น ไม่ประกอบชื่อเดือนเอง */
const SHORT_MONTH = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', month: 'short' });
const shortMonth = (periodMonth: PeriodMonth) => SHORT_MONTH.format(new Date(`${periodMonth}T00:00:00+07:00`));

/**
 * สีของแท่งรายจ่าย: ห้ามเฉดเขียว (design.md §1.1 — เขียว = รายรับของแอปนี้)
 * หมวดอาจตั้งสีเขียวไว้ (chart-4 = #16A34A, chart-7 = #65A30D) → ใช้ --balance แทน
 * เทียบด้วย "ชื่อโทเคน" ที่เก็บใน DB ไม่ใช่ค่า hex (ห้าม hardcode hex ใน component)
 */
const GREEN_TOKENS = new Set(['--chart-4', '--chart-7']);
const expenseBarColor = (token: string | null | undefined) => (!token || GREEN_TOKENS.has(token) ? '--balance' : token);

/** แถวกราฟหมวด — สูงสุด 8 แถว: เกินกว่านั้นรวมที่เหลือเป็น "อื่น ๆ" (ไม่วนสีซ้ำ — §1.1) */
type CategoryBar = { key: string; name: string; amount: number; color: string };

function toCategoryBars(
  byCategory: Map<string, number>,
  categoryById: Map<string, { name: string; color: string | null }>,
): CategoryBar[] {
  const sorted = [...byCategory.entries()]
    .map(([id, amount]) => ({
      key: id,
      name: categoryById.get(id)?.name ?? 'ไม่ระบุหมวด',
      amount,
      color: expenseBarColor(categoryById.get(id)?.color),
    }))
    .sort((a, b) => b.amount - a.amount);

  if (sorted.length <= 8) return sorted;

  const head = sorted.slice(0, 7);
  const rest = sorted.slice(7).reduce((sum, bar) => sum + bar.amount, 0);
  return [...head, { key: 'other', name: 'อื่น ๆ', amount: rest, color: '--balance' }];
}

/**
 * บล็อกเทียบงบ — query ของตัวเองแล้วสตรีมเข้ามาด้วย Suspense
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
        <p className="text-text-muted">ยังไม่ได้ตั้งงบของเดือนนี้</p>
        {/* พาเดือนที่กำลังดูอยู่ไปด้วย — ตั้งงบของเดือนนั้นได้ทันที ไม่ต้องสลับซ้ำ (spec §2) */}
        <Link
          href={withMonth('/settings/budgets', periodMonth)}
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

/** แท่งแนวตั้ง 6 งวด (div/CSS ล้วน) — ไม่มีแกน Y จึงมี caption บอกค่าสูงสุด (spec §4) */
function TrendChart({ trend }: { trend: MonthTrend[] }) {
  const max = Math.max(...trend.map((point) => point.expense));
  const peak = trend.find((point) => point.expense === max);
  const current = trend[trend.length - 1]?.periodMonth;

  return (
    <>
      <p className="mt-1 text-[13px] leading-[18px] text-text-muted">
        {max > 0 && peak ? `สูงสุด ${formatSatang(max)} · ${formatMonthLabelTh(peak.periodMonth)}` : 'ยังไม่มีรายจ่ายในช่วงนี้'}
      </p>
      <div className="mt-2 flex h-36 items-stretch gap-2">
        {trend.map((point) => {
          const zero = point.expense === 0;
          return (
            <div key={point.periodMonth} className="flex h-full flex-1 flex-col items-center gap-1">
              {/*
                ความสูงของแท่งเป็น % ของ "พื้นที่แท่ง" (flex-1) ไม่ใช่ของทั้งคอลัมน์:
                ถ้าวัดจากทั้งคอลัมน์ ป้ายเดือนด้านล่างจะกินที่แล้วบีบแท่งสูง ๆ ให้เท่ากันหมด (เจอจริง 122/144px)
              */}
              <div className="flex w-full flex-1 flex-col items-center justify-end">
                {/* เดือนยอด 0: แท่ง 2px สี --border + ป้าย "—" (ไม่ใช่แท่งล่องหนที่ดูเหมือนพัง) */}
                {zero ? <span className="text-[13px] leading-[18px] text-text-muted">—</span> : null}
                <div
                  role="img"
                  aria-label={
                    zero
                      ? `${shortMonth(point.periodMonth)} ไม่มีรายจ่าย`
                      : `${shortMonth(point.periodMonth)} รายจ่าย ${formatSatang(point.expense)}`
                  }
                  style={{ height: zero ? '2px' : `${(point.expense / max) * 100}%` }}
                  className={`w-full shrink-0 rounded-t-[8px] ${zero ? 'bg-border' : 'border border-expense bg-expense'}`}
                />
              </div>
              <span
                className={`text-[13px] leading-[18px] ${
                  point.periodMonth === current ? 'font-semibold text-text' : 'text-text-muted'
                }`}
              >
                {shortMonth(point.periodMonth)}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * S5 สรุป (design.md §4 S5 + spec §4) — กราฟ div/CSS ล้วน ไม่ใส่ไลบรารี
 * งวดเดือนมาจาก `?m` (ค่าขยะ → เดือนปัจจุบัน) · แนวนิยม m-5..m และยอดตามหมวดเป็นของงวดนั้น
 */
export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const gate = await gateSession();
  if (gate.unavailable) return <LoadFailed />;
  const { userId } = gate.user;
  const periodMonth = periodMonthFromParam((await searchParams).m);

  let trend: MonthTrend[] = [];
  let bars: CategoryBar[] = [];
  let totalExpense = 0;
  try {
    const db = getDb();
    const [trendRows, byCategory] = await Promise.all([
      trendByMonth(db, userId, periodMonth, 6),
      monthExpenseByCategory(db, userId, periodMonth),
    ]);
    trend = trendRows;
    totalExpense = [...byCategory.values()].reduce((sum, amount) => sum + amount, 0);
    const categoryById = await listCategoriesById(db, userId, [...byCategory.keys()]);
    bars = toCategoryBars(byCategory, categoryById);
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // สัญญาณ prerender ของ Next — ห้ามกลืน
    console.error('[jodjai] โหลดสรุปไม่สำเร็จ:', error);
    return <LoadFailed message="โหลดสรุปไม่สำเร็จ" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">สรุป</h1>
        <MonthSwitcher basePath="/summary" scope={periodMonth} />
      </header>

      <section aria-labelledby="trend-label" className="rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
        <h2 id="trend-label" className="text-xl font-semibold">
          รายจ่าย 6 เดือน
        </h2>
        <TrendChart trend={trend} />
      </section>

      <section aria-labelledby="cat-label" className="rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-2">
          <h2 id="cat-label" className="text-xl font-semibold">
            รายจ่ายตามหมวด
          </h2>
          <span className="num text-text-muted">{formatSatang(totalExpense)}</span>
        </div>
        {bars.length === 0 ? (
          <p className="mt-1 text-text-muted">เดือนนี้ยังไม่มีรายจ่าย</p>
        ) : (
          <ul className="mt-1">
            {bars.map((bar) => (
              <li key={bar.key} className="py-1.5">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-pill"
                    style={{ background: `var(${bar.color})` }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{bar.name}</span>
                    <span className="block text-[13px] leading-[18px] text-text-muted">
                      {totalExpense > 0 ? ((bar.amount / totalExpense) * 100).toFixed(1) : '0.0'}% ของรายจ่าย ·{' '}
                      {formatSatang(bar.amount)}
                    </span>
                  </span>
                </div>
                {/* แท่งแนวนอนเทียบความยาว — สูง 8px (§1.4 radius pill) · aria-hidden เพราะตัวเลขข้างบนบอกครบแล้ว */}
                <div className="mt-1 h-2 overflow-hidden rounded-pill bg-surface-2" aria-hidden="true">
                  <span
                    className="block h-full rounded-pill"
                    style={{
                      width: `${totalExpense > 0 ? Math.min(100, (bar.amount / totalExpense) * 100) : 0}%`,
                      background: `var(${bar.color})`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
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

export const metadata = { title: 'สรุป · จดจ่าย' };
