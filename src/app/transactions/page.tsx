import Link from 'next/link';

import { LoadFailed } from '@/components/LoadFailed';
import { LoadMoreLink } from '@/components/LoadMoreLink';
import { MonthSwitcher } from '@/components/MonthSwitcher';
import { FilterBar, SearchBox, type ActiveFilters } from '@/components/TransactionFilters';
import { TransactionList, dayLabel, type TransactionRowView } from '@/components/TransactionRow';
import { emptyStateFor } from '@/components/transactions-view';
import { getDb } from '@/db';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories, listCategoriesById, type CategoryRow } from '@/db/queries/categories';
import { listTransactionPage } from '@/db/queries/transactions';
import { periodMonthFromParam, periodMonthOfBkk } from '@/lib/month';
import { withMonth } from '@/lib/month-url';
import { isNextControlFlow } from '@/lib/next-signals';
import { gateSession } from '@/lib/session';

/** 50 แถวต่อหน้าตาม keyset (spec §3) · เพดาน 10 หน้า กัน URL ประสงค์ร้าย */
const PAGE_LIMIT = 50;
const MAX_PAGES = 10;

const KINDS = ['income', 'expense', 'transfer'] as const;

/** uuid มาตรฐาน — ค่าจาก URL ต้องผ่านก่อนส่งเข้า query (ไม่งั้น PG ฟ้อง 22P02 → 500) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Promise<{
  m?: string;
  kind?: string;
  categoryId?: string;
  accountId?: string;
  q?: string;
  pages?: string;
}>;

/**
 * S4 รายการทั้งหมด (design.md §4 S4 + spec §1–§3) — ข้อมูลจริงจาก DB
 * - งวดเดือน = `?m` (ค่าขยะ → เดือนปัจจุบัน ไม่ 500) · cursor ของ keyset อยู่ในหน่วยความจำ ไม่ขึ้น URL
 * - โหลดเพิ่ม = ลิงก์ `?pages=N` (ไม่ทำ auto scroll: URL เป็น state เดียว + แตะง่าย + ใช้ keyboard ได้)
 */
export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const gate = await gateSession();
  if (gate.unavailable) return <LoadFailed />;
  const { userId } = gate.user;

  const params = await searchParams;
  const periodMonth = periodMonthFromParam(params.m);
  const kind = KINDS.find((value) => value === params.kind);
  const categoryId = params.categoryId && UUID_RE.test(params.categoryId) ? params.categoryId : undefined;
  const accountId = params.accountId && UUID_RE.test(params.accountId) ? params.accountId : undefined;
  const q = typeof params.q === 'string' && params.q !== '' ? params.q : undefined;
  const pages = Math.min(MAX_PAGES, Math.max(1, Number.parseInt(params.pages ?? '1', 10) || 1));

  const active: ActiveFilters = { kind, categoryId, accountId, q };
  const activeCount = [kind, categoryId, accountId, q].filter(Boolean).length;

  // ตัวกรองปัจจุบันเป็น query string — ใช้เป็นฐานของทุกลิงก์ (ไม่รวม pages)
  const base = new URLSearchParams({ m: periodMonth });
  if (kind) base.set('kind', kind);
  if (categoryId) base.set('categoryId', categoryId);
  if (accountId) base.set('accountId', accountId);
  if (q) base.set('q', q);
  const baseQuery = base.toString();
  const basePath = `/transactions?${baseQuery}`;

  let rows: TransactionRowView[] = [];
  let hasMore = false;
  let categories: CategoryRow[] = [];
  let accounts: { id: string; name: string }[] = [];
  let hasAnyTransaction = true;

  try {
    const db = getDb();
    const [categoryOptions, accountRows] = await Promise.all([listCategories(db, userId), listAccounts(db, userId)]);
    categories = categoryOptions;
    accounts = accountRows.map((account) => ({ id: account.id, name: account.name }));

    // keyset: วน N รอบตาม ?pages — รอบต่อไปใช้ nextCursor ของรอบก่อน (ไม่ใช้ OFFSET)
    const filters = {
      periodMonth,
      categoryIds: categoryId ? [categoryId] : undefined,
      kind,
      accountId,
      q,
      limit: PAGE_LIMIT,
    };
    const pageRows = [];
    let cursor: { occurredAt: Date; id: string } | undefined;
    for (let page = 0; page < pages; page++) {
      const result = await listTransactionPage(db, userId, { ...filters, cursor });
      pageRows.push(...result.rows);
      hasMore = result.nextCursor !== null;
      if (!hasMore) break;
      cursor = result.nextCursor ?? undefined;
    }

    // ชื่อ/สีหมวดของแถวที่แสดง (1 query · คืนหมวดที่ archive แล้วด้วย)
    const categoryById = await listCategoriesById(
      db,
      userId,
      pageRows.map((row) => row.categoryId).filter((id): id is string => id != null),
    );
    rows = pageRows.map((txn) => {
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

    // แยก "เดือนนี้ว่าง" กับ "ผู้ใช้ยังไม่เคยบันทึกเลย" — 1 query (นับทุกเดือน)
    if (rows.length === 0 && activeCount === 0) {
      hasAnyTransaction = (await listTransactionPage(db, userId, { limit: 1 })).total > 0;
    }
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // สัญญาณ prerender ของ Next — ห้ามกลืน
    console.error('[jodjai] โหลดรายการไม่สำเร็จ:', error);
    return <LoadFailed message="โหลดรายการไม่สำเร็จ" />;
  }

  const isCurrentMonth = periodMonth === periodMonthOfBkk();
  const emptyState = emptyStateFor({
    rowCount: rows.length,
    activeFilterCount: activeCount,
    hasAnyTransaction,
    isCurrentMonth,
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">รายการทั้งหมด</h1>
        <MonthSwitcher basePath={basePath} periodMonth={periodMonth} />
      </header>

      <SearchBox base={baseQuery} q={q ?? ''} />
      <FilterBar base={baseQuery} active={active} categories={categories} accounts={accounts} />

      {activeCount > 0 ? (
        <div className="flex min-h-11 items-center justify-between gap-2 text-[13px] leading-[18px]">
          <span className="text-text-muted">กรองอยู่ {activeCount} ตัว</span>
          {/* ล้างตัวกรอง = คง `m` ไว้ (spec §2) */}
          <Link href={withMonth('/transactions', periodMonth)} className="flex min-h-11 items-center font-semibold text-[var(--balance)]">
            ล้างตัวกรอง
          </Link>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <>
          <TransactionList items={rows} />
          <p className="text-[13px] leading-[18px] text-text-muted">แสดง {rows.length} รายการ</p>
          {hasMore && pages < MAX_PAGES ? (
            <LoadMoreLink href={withMonth(`/transactions?${baseQuery}`, periodMonth, { pages: pages + 1 })} />
          ) : (
            // ถึงเพดาน 10 หน้า (hasMore ยังจริง) ก็ต้องมีข้อความจบ — ไม่ใช่ทางตันที่ไม่มีทั้งปุ่มและข้อความ
            <p className="text-center text-[13px] leading-[18px] text-text-muted">— จบรายการ —</p>
          )}
        </>
      ) : emptyState ? (
        <div className="flex flex-col items-start gap-2 rounded-card border border-border bg-surface p-4">
          <p className="text-text-muted">{emptyState.message}</p>
          {emptyState.action === 'clear-filters' ? (
            <Link href={withMonth('/transactions', periodMonth)} className="flex min-h-11 items-center font-semibold text-[var(--balance)]">
              ล้างตัวกรอง
            </Link>
          ) : null}
          {emptyState.action === 'back-to-current' ? (
            <Link href={withMonth('/transactions', periodMonthOfBkk())} className="flex min-h-11 items-center font-semibold text-[var(--balance)]">
              กลับเดือนนี้
            </Link>
          ) : null}
          {emptyState.action === 'open-add' ? (
            // ปุ่มเปิด sheet เพิ่มรายการ — AddEntryFab (ใน layout) ดักคลิกที่ [data-open-add]
            <button type="button" data-open-add className="min-h-11 rounded-btn bg-balance px-4 font-bold text-on-accent">
              เพิ่มรายการ
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const metadata = { title: 'รายการทั้งหมด · จดจ่าย' };
