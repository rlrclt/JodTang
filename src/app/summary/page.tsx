import { BUDGETS, TREND, TRANSACTIONS, categoryOf } from '@/lib/fixtures';
import { expenseByCategory, formatSatang, periodTotals } from '@/lib/money';

const WARN_AT = 0.8; // §1.1: ใช้ไป ≥ 80% ของงบ = ใกล้เกินงบ (ขึ้น --warn + คำกำกับ ไม่ใช้สีอย่างเดียว)

/**
 * S5 สรุป (design.md §4 S5) — กราฟทำด้วย div + CSS ล้วน ไม่ใส่ไลบรารี (§7)
 * ยอดทุกตัวมาจาก src/lib/money.ts · กราฟห้ามใช้เฉดเขียว (§1.1) จึงใช้ --expense/ชุดกราฟตามที่กำหนด
 */
export default function SummaryPage() {
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
        <p className="text-[13px] leading-[18px] text-text-muted">กันยายน 2569</p>
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
                  {((amount / totals.expense) * 100).toFixed(1)}% ของรายจ่าย
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
        <ul className="mt-1">
          {BUDGETS.map((budget) => {
            const category = categoryOf(budget.categoryId);
            const ratio = budget.used / budget.total;
            const warn = ratio >= WARN_AT;
            return (
              <li key={budget.categoryId} className="py-2">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{category?.name ?? 'ไม่ระบุหมวด'}</span>
                    <span className="block text-[13px] leading-[18px] text-text-muted">
                      ใช้ไป {Math.round(ratio * 100)}% ของงบเดือนนี้
                    </span>
                  </span>
                  <span className={`num font-semibold ${warn ? 'text-warn' : ''}`}>
                    {formatSatang(budget.used)} / {formatSatang(budget.total)}
                  </span>
                </div>
                <div
                  role="img"
                  aria-label={`ใช้ไป ${Math.round(ratio * 100)}% ของงบ ${category?.name ?? ''}`}
                  className="mt-2 h-2 overflow-hidden rounded-pill border border-border bg-surface-2"
                >
                  <span
                    style={{ width: `${Math.min(100, ratio * 100)}%` }}
                    className={`block h-full rounded-pill ${warn ? 'bg-warn' : 'bg-balance'}`}
                  />
                </div>
                {/* สถานะต้องมีคำกำกับ ไม่สื่อด้วยสีอย่างเดียว (§1.1) */}
                <p className={`mt-1 text-[13px] leading-[18px] ${warn ? 'text-warn' : 'text-text-muted'}`}>
                  {warn ? '⚠ ใกล้เกินงบ' : 'อยู่ในงบ'}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
