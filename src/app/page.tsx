import Link from 'next/link';

import { TransactionList, dayLabel, type TransactionRowView } from '@/components/TransactionRow';
import { getDb } from '@/db';
import { listCategories, type CategoryRow } from '@/db/queries/categories';
import { monthTotals, recentTransactions } from '@/db/queries/transactions';
import { formatMonthLabelTh, periodMonthOfBkk } from '@/lib/month';
import { formatRowAmount, formatSatang } from '@/lib/money';
import { requireSession } from '@/lib/session';

/** จำนวนแถวล่าสุดในหน้าแรก (design.md §4 S2) */
const RECENT_LIMIT = 20;

/**
 * S2 หน้าแรก (design.md §4 S2) + §1.3/§2 — ข้อมูลจริงจาก DB ของผู้ใช้ใน session
 * ยอดทุกตัวคิดที่ src/lib/money.ts ที่เดียว (monthTotals) — ห้ามบวก/ลบเงินในหน้านี้
 * เดือนก่อนหน้า/ถัดไป ยังกดไม่เปลี่ยนข้อมูล (ยังไม่ทำในรอบนี้)
 */
export default async function HomePage() {
  const { userId } = await requireSession();
  const db = getDb();
  const periodMonth = periodMonthOfBkk();

  // ทุก query ผูก userId ของ session + กรอง deleted_at ให้แล้วในชั้น query (src/db/queries/transactions.ts)
  const [totals, recent, categories] = await Promise.all([
    monthTotals(db, userId, periodMonth),
    recentTransactions(db, userId, RECENT_LIMIT),
    listCategories(db, userId),
  ]);

  // ชื่อ/สีหมวดของแถว — Record เพราะคีย์เป็น id (uuid) สตริงล้วน
  const categoryById: Record<string, CategoryRow> = {};
  for (const category of categories) categoryById[category.id] = category;

  const recentViews: TransactionRowView[] = recent.map((txn) => {
    const category = txn.categoryId ? categoryById[txn.categoryId] : undefined;
    return {
      id: txn.id,
      kind: txn.kind,
      amount: txn.amount,
      dateLabel: dayLabel(txn.occurredAt),
      categoryName: category?.name ?? null,
      categoryColor: category?.color ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex min-h-11 items-center justify-between gap-2">
        <button
          type="button"
          aria-label="เดือนก่อนหน้า"
          className="flex size-11 items-center justify-center rounded-input text-text-muted"
        >
          ‹
        </button>
        <h1 className="text-2xl font-semibold">{formatMonthLabelTh(periodMonth)}</h1>
        <button
          type="button"
          aria-label="เดือนถัดไป"
          className="flex size-11 items-center justify-center rounded-input text-text-muted"
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
        {recentViews.length > 0 ? (
          <TransactionList items={recentViews} />
        ) : (
          <p className="text-text-muted">เริ่มบันทึกรายการแรก</p>
        )}
      </section>
    </div>
  );
}
