import Link from 'next/link';

import { LoadFailed } from '@/components/LoadFailed';
import { LoadMoreLink } from '@/components/LoadMoreLink';
import { RetryBar } from '@/components/RetryBar';
import { dayLabel, type TransactionRowView } from '@/components/TransactionRow';
import { getDb } from '@/db';
import { listCategoriesById } from '@/db/queries/categories';
import { listDeletedTransactions, type DeletedCursor, type DeletedTxn } from '@/db/queries/transactions';
import { isNextControlFlow } from '@/lib/next-signals';
import { gateSession } from '@/lib/session';

import { TrashRow } from './TrashRow';
import { logServer } from '@/lib/log';

export const metadata = { title: 'รายการที่ลบแล้ว · จดจ่าย' };

/** 50 แถวต่อหน้า (keyset) · เพดาน 10 หน้า — เท่ากับหน้ารายการทั้งหมด กัน URL ประสงค์ร้าย */
const PAGE_LIMIT = 50;
const MAX_PAGES = 10;

type SearchParams = Promise<{ pages?: string }>;

/**
 * รายการที่ลบแล้ว + กู้คืน (wave21 · local://wave21-design.md)
 *
 * - เป็นหน้าของ "กู้คืน" ไม่ใช่ "ค้นหา": **ไม่มีช่องค้นหา/ตัวกรอง/MonthSwitcher** (สเปก §2 ตัดออกชัดเจน)
 * - เรียง `deleted_at desc, id desc` ด้วย keyset เดียวกับหน้าอื่น · cursor ส่งกลับทั้งก้อนที่ชั้นข้อมูลคืนมา
 * - แถวเดียวกับหน้าอื่น (TransactionRow) แต่บรรทัดรองบอก "ลบเมื่อ <วัน>" แทนวันที่เกิดรายการ
 * - ผู้ใช้ที่ยังไม่เคยกดลบจะเห็นสถานะว่าง ไม่ใช่หน้ารก
 */
export default async function TrashPage({ searchParams }: { searchParams: SearchParams }) {
  const gate = await gateSession();
  if (gate.unavailable) return <LoadFailed />;
  const { userId } = gate.user;
  const params = await searchParams;
  const pages = Math.min(MAX_PAGES, Math.max(1, Number.parseInt(params.pages ?? '1', 10) || 1));

  const rows: DeletedTxn[] = [];
  let hasMore = false;
  let views: TransactionRowView[] = [];
  let loaded = false;

  try {
    const db = getDb();
    let cursor: DeletedCursor | undefined;
    for (let page = 0; page < pages; page++) {
      const result = await listDeletedTransactions(db, userId, { cursor, limit: PAGE_LIMIT });
      rows.push(...result.rows);
      hasMore = result.nextCursor !== null;
      if (!hasMore) break;
      cursor = result.nextCursor ?? undefined; // ส่งกลับทั้งก้อนตามที่ชั้นข้อมูลคืน (ไม่ประกอบ cursor เอง)
    }

    // ชื่อ/สีหมวดของแถวที่แสดง — คืนหมวดที่ archive แล้วด้วย (แถวต้องโชว์ "เลิกใช้แล้ว" ไม่ซ่อน)
    const categoryById = await listCategoriesById(
      db,
      userId,
      rows.map((row) => row.categoryId).filter((id): id is string => id != null),
    );
    views = rows.map((txn) => {
      const category = txn.categoryId ? categoryById.get(txn.categoryId) : undefined;
      return {
        id: txn.id,
        kind: txn.kind,
        amount: txn.amount,
        // dayLabel() ตัวเดิม — บรรทัดรองของถังขยะบอกวันที่ "ลบ" ไม่ใช่วันที่เกิดรายการ
        dateLabel: `ลบเมื่อ ${dayLabel(txn.deletedAt)}`,
        categoryName: category?.name ?? null,
        categoryColor: category?.color ?? null,
        categoryArchived: category?.archivedAt != null,
      };
    });
    loaded = true;
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // สัญญาณ prerender ของ Next — ห้ามกลืน
    logServer('trash.load_failed', { error, route: '/settings/trash' });
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
        <h1 className="text-2xl font-semibold">รายการที่ลบแล้ว</h1>
      </header>

      <p className="text-[13px] leading-[18px] text-text-muted">
        รายการที่ลบแล้วยังไม่ถูกลบจริง — กดกู้คืนเพื่อกลับเข้ายอด และกลับไปอยู่เดือนเดิมของรายการ
      </p>

      {!loaded ? (
        <RetryBar message="โหลดรายการที่ลบแล้วไม่สำเร็จ" />
      ) : views.length > 0 ? (
        <>
          <ul className="overflow-hidden rounded-card border border-border bg-surface">
            {views.map((view) => (
              <TrashRow key={view.id} view={view} />
            ))}
          </ul>
          <p className="text-[13px] leading-[18px] text-text-muted">แสดง {views.length} รายการ</p>
          {hasMore && pages < MAX_PAGES ? (
            <LoadMoreLink href={`/settings/trash?pages=${pages + 1}`} />
          ) : hasMore ? (
            // ถึงเพดาน 10 หน้าแต่ยังมีต่อ — ต้องไม่บอกว่า "จบ" (บทเรียน wave19b: ข้อความต้องตรงกับความจริง)
            <p className="text-center text-[13px] leading-[18px] text-text-muted">
              แสดง {views.length} รายการแรก · ยังมีอีก
            </p>
          ) : (
            <p className="text-center text-[13px] leading-[18px] text-text-muted">— จบรายการ —</p>
          )}
        </>
      ) : (
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-text-muted">ยังไม่มีรายการที่ลบ</p>
          <p className="mt-1 text-[13px] leading-[18px] text-text-muted">
            รายการที่ลบจากหน้าแรกหรือหน้ารายการทั้งหมดจะมาเก็บไว้ที่นี่ กดกู้คืนได้ทุกเมื่อ
          </p>
        </div>
      )}
    </div>
  );
}
