import Link from 'next/link';
import { Suspense } from 'react';

import { FirstRunCard, FirstRunCardSkeleton } from '@/components/FirstRunCard';
import { TransactionList, dayLabel, type TransactionRowView } from '@/components/TransactionRow';
import { LoadFailed } from '@/components/LoadFailed';
import { getDb } from '@/db';
import { listCategoriesById } from '@/db/queries/categories';
import { listTransactionPage, monthTotals } from '@/db/queries/transactions';
import { firstRunState } from '@/db/queries/user-state';
import { formatMonthLabelTh, periodMonthFromParam, shiftPeriodMonth } from '@/lib/month';
import { withMonth } from '@/lib/month-url';
import { formatRowAmount, formatSatang } from '@/lib/money';
import { isNextControlFlow } from '@/lib/next-signals';
import { gateSession } from '@/lib/session';

/** จำนวนแถวล่าสุดในหน้าแรก (design.md §4 S2) */
const RECENT_LIMIT = 20;

/**
 * การ์ด "เริ่มใช้งานเร็ว" (wave12 §2) — โหลดเองใน Suspense เพื่อไม่ให้หน้าแรกทั้งหน้าต้องรอ
 * **fail-closed**: อ่าน `firstRunState` ไม่ได้ = ซ่อนการ์ด (โชว์การ์ดผิดให้คนที่มีข้อมูลแล้วแย่กว่าไม่โชว์)
 * ตัวอื่นของหน้าแรกไม่กระทบ เพราะความล้มเหลวอยู่แค่ในบล็อกนี้
 */
async function FirstRunSection({ userId }: { userId: string }) {
  let state;
  try {
    state = await firstRunState(getDb(), userId);
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // สัญญาณ prerender ของ Next — ห้ามกลืน
    console.error('[jodjai] อ่าน firstRunState ไม่ได้ — ซ่อนการ์ดเริ่มใช้งาน:', error);
    return null;
  }

  const isFirstRun = !state.hasAccounts && !state.hasCategories && !state.hasTransactions;
  return isFirstRun ? <FirstRunCard /> : null;
}

/**
 * S2 หน้าแรก (design.md §4 S2) + §1.3/§2 — ข้อมูลจริงจาก DB ของผู้ใช้ใน session
 * ยอดทุกตัวคิดที่ src/lib/money.ts ที่เดียว (monthTotals) — ห้ามบวก/ลบเงินในหน้านี้
 * งวดเดือนมาจาก `?m` (ค่าขยะ → เดือนปัจจุบัน ไม่ 500) · ลูกศร ‹ › เป็นลิงก์ ไม่มี JS
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const gate = await gateSession();
  if (gate.unavailable) return <LoadFailed />;
  const { userId } = gate.user;
  const periodMonth = periodMonthFromParam((await searchParams).m);

  // ทุก query ผูก userId ของ session + กรอง deleted_at ให้แล้วในชั้น query (src/db/queries/transactions.ts)
  let totals;
  let recent;
  let categoryById;
  try {
    const [monthTotalsRow, recentPage] = await Promise.all([
      monthTotals(getDb(), userId, periodMonth),
      // รายการล่าสุด "ของเดือนนั้น" (ไม่ใช่ล่าสุดทั้งบัญชี) — ต้องตรงกับยอดที่การ์ดด้านบน (spec §1 ข้อ 1)
      listTransactionPage(getDb(), userId, { periodMonth, limit: RECENT_LIMIT }),
    ]);
    totals = monthTotalsRow;
    recent = recentPage.rows;
    // ชื่อ/สีหมวดของแถวที่แสดง — 1 query (listCategoriesById) และคืนหมวดที่ archive แล้วด้วย
    // ไม่งั้นรายการเก่าของหมวดที่เลิกใช้จะเหลือแค่คำตาม kind (minor 4e)
    categoryById = await listCategoriesById(
      getDb(),
      userId,
      recent.map((txn) => txn.categoryId).filter((id): id is string => id != null),
    );
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // สัญญาณ prerender ของ Next — ห้ามกลืน
    // DB ล่ม/เน็ตขาด: ห้ามปล่อยให้ throw (ผู้ใช้จะเจอ 500 เปล่า/404 อังกฤษ) — แสดงข้อความไทย + ปุ่มลองใหม่
    console.error('[jodjai] โหลดข้อมูลหน้าแรกไม่สำเร็จ:', error);
    return <LoadFailed message="โหลดยอดเดือนนี้ไม่สำเร็จ" />;
  }

  const recentViews: TransactionRowView[] = recent.map((txn) => {
    const category = txn.categoryId ? categoryById.get(txn.categoryId) : undefined;
    return {
      id: txn.id,
      kind: txn.kind,
      amount: txn.amount,
      dateLabel: dayLabel(txn.occurredAt),
      categoryName: category?.name ?? null,
      categoryColor: category?.color ?? null,
      categoryArchived: category?.archivedAt != null,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex min-h-11 items-center justify-between gap-2">
        <Link
          href={withMonth('/', shiftPeriodMonth(periodMonth, -1))}
          rel="prev"
          aria-label="เดือนก่อนหน้า"
          className="flex size-11 items-center justify-center rounded-input text-text-muted"
        >
          ‹
        </Link>
        <h1 className="text-2xl font-semibold">{formatMonthLabelTh(periodMonth)}</h1>
        <Link
          href={withMonth('/', shiftPeriodMonth(periodMonth, 1))}
          rel="next"
          aria-label="เดือนถัดไป"
          className="flex size-11 items-center justify-center rounded-input text-text-muted"
        >
          ›
        </Link>
      </header>

      <Suspense fallback={<FirstRunCardSkeleton />}>
        <FirstRunSection userId={userId} />
      </Suspense>

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
          <Link href={withMonth('/transactions', periodMonth)} className="flex min-h-11 items-center px-1 font-semibold text-[var(--balance)]">
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
