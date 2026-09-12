import Link from 'next/link';

import { TransactionList } from '@/components/TransactionRow';
import { MONTH_LABEL, RECENT_LIMIT, TRANSACTIONS } from '@/lib/fixtures';
import { formatRowAmount, formatSatang, periodTotals } from '@/lib/money';

/**
 * S2 หน้าแรก (design.md §4 S2) + §1.3/§2
 * ยอดทุกตัวคิดที่ src/lib/money.ts ที่เดียว — ห้ามบวก/ลบเงินในหน้านี้ (periodTotals กรอง deleted_at + kind ให้แล้ว)
 * เดือนก่อนหน้า/ถัดไป ยังกดไม่เปลี่ยนข้อมูล (รอต่อ DB — เฟส 2)
 */
export default function HomePage() {
  const totals = periodTotals(TRANSACTIONS);
  const recent = TRANSACTIONS.slice(0, RECENT_LIMIT);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex min-h-11 items-center justify-between gap-2">
        <button
          type="button"
          aria-label="เดือนก่อนหน้า"
          className="flex size-11 items-center justify-center rounded-[8px] text-text-muted"
        >
          ‹
        </button>
        <h1 className="text-2xl font-semibold">{MONTH_LABEL}</h1>
        <button
          type="button"
          aria-label="เดือนถัดไป"
          className="flex size-11 items-center justify-center rounded-[8px] text-text-muted"
        >
          ›
        </button>
      </header>

      <section
        aria-labelledby="kpi-label"
        className="rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]"
      >
        <h2 id="kpi-label" className="text-[13px] leading-[18px] text-text-muted">
          คงเหลือเดือนนี้
        </h2>
        {/* display 32/40 (§1.2) · tabular + ชิดขวาเสมอ · ไม่มี +/- เพราะเป็นยอดคงเหลือ */}
        <p className="num text-right text-[32px] font-bold leading-10">{formatSatang(totals.balance)}</p>
        <dl className="mt-2">
          <div className="flex min-h-11 items-center justify-between gap-2">
            <dt className="text-text-muted">รับ</dt>
            <dd className="num font-semibold text-income">
              {formatRowAmount({ kind: 'income', amount: totals.income })}
            </dd>
          </div>
          <div className="flex min-h-11 items-center justify-between gap-2">
            <dt className="text-text-muted">จ่าย</dt>
            <dd className="num font-semibold text-expense">
              {formatRowAmount({ kind: 'expense', amount: totals.expense })}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="recent-label" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="recent-label" className="text-xl font-semibold">
            รายการล่าสุด
          </h2>
          <Link href="/transactions" className="flex min-h-11 items-center px-1 font-semibold text-[var(--balance)]">
            ดูทั้งหมด
          </Link>
        </div>
        {recent.length > 0 ? (
          <TransactionList items={recent} />
        ) : (
          <p className="text-text-muted">เริ่มบันทึกรายการแรก</p>
        )}
      </section>
    </div>
  );
}
