import type { BudgetProgress } from '@/db/queries/budgets';
import { formatSatang } from '@/lib/money';

/** เกณฑ์ "ใกล้เกินงบ" (design.md §1.1) — ค่ากลางที่เดียวของทั้งแอป (เดิมฝังอยู่ในหน้า /summary) */
export const WARN_AT = 0.8;

/** สถานะของงบหนึ่งแถวที่หน้าจอต้องใช้ — คำนวณที่เดียว ไม่กระจาย `used / amount` ไปตามหน้า */
export function budgetStatus(used: number, budgetAmount: number) {
  const ratio = used / budgetAmount; // งบต้อง > 0 เสมอ (budgets_amount_check ฝั่ง DB)
  return {
    ratio,
    warn: ratio >= WARN_AT,
    /** เกินงบจริง: ใช้ไปมากกว่างบ → ต้องมีข้อความบอก ไม่ใช้สีอย่างเดียว */
    overBy: Math.max(0, used - budgetAmount),
  };
}

/**
 * แถวเทียบงบในหน้า /summary (design.md §4 S5 · ข้อเสนอ §3)
 * - ≥80% = --warn + ⚠ + คำกำกับ · เกินงบ = ข้อความ "เกินงบ ฿X" และแถบไม่ล้น 100%
 * - หมวดที่เลิกใช้แล้วยังโชว์ (ถ้าซ่อน ยอดจะขาดเงียบ ๆ) ติดป้าย "เลิกใช้แล้ว"
 */
export function BudgetRow({ row }: { row: BudgetProgress }) {
  const { ratio, warn, overBy } = budgetStatus(row.used, row.amount);
  const percent = Math.round(ratio * 100);

  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="block truncate font-semibold">{row.categoryName}</span>
            {row.categoryArchivedAt ? (
              <span className="shrink-0 rounded-pill border border-border-strong px-2 py-0.5 text-[13px] leading-[18px] text-text-muted">
                เลิกใช้แล้ว
              </span>
            ) : null}
          </span>
          <span className="block text-[13px] leading-[18px] text-text-muted">ใช้ไป {percent}% ของงบเดือนนี้</span>
        </span>
        <span className={`num font-semibold ${warn ? 'text-warn' : ''}`}>
          {formatSatang(row.used)} / {formatSatang(row.amount)}
        </span>
      </div>
      <div
        role="img"
        aria-label={`ใช้ไป ${percent}% ของงบ ${row.categoryName}`}
        className="mt-2 h-2 overflow-hidden rounded-pill border border-border bg-surface-2"
      >
        {/* แถบกว้างไม่เกิน 100% แม้ใช้เกินงบ (§3) */}
        <span
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
          className={`block h-full rounded-pill ${warn ? 'bg-warn' : 'bg-balance'}`}
        />
      </div>
      {/* สถานะต้องมีคำกำกับ ไม่สื่อด้วยสีอย่างเดียว (§1.1) */}
      <p className={`mt-1 text-[13px] leading-[18px] ${warn ? 'text-warn' : 'text-text-muted'}`}>
        {overBy > 0 ? `เกินงบ ${formatSatang(overBy)}` : warn ? '⚠ ใกล้เกินงบ' : 'อยู่ในงบ'}
      </p>
    </li>
  );
}

/** skeleton ของบล็อกงบ — โครงเท่าของจริง (ไม่ใช่ spinner กลางจอ · design §2/§3) */
export function BudgetSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="mt-1" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="animate-pulse py-2">
          <div className="flex items-center gap-3">
            <span className="h-4 flex-1 rounded-[4px] bg-surface-2" />
            <span className="h-4 w-24 rounded-[4px] bg-surface-2" />
          </div>
          <div className="mt-2 h-2 rounded-pill bg-surface-2" />
          <div className="mt-2 h-3 w-20 rounded-[4px] bg-surface-2" />
        </li>
      ))}
    </ul>
  );
}
