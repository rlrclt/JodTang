import { TransactionList, type TransactionRowView } from '@/components/TransactionRow';
import { MONTH_LABEL, TRANSACTIONS, categoryOf } from '@/lib/fixtures';
import { requireSession } from '@/lib/session';

// ตัวกรองตาม §4 S4 — เฟส 1 ยังกดไม่เปลี่ยนผลลัพธ์ (static placeholder ให้เห็นหน้าตา)
const FILTERS = ['ทั้งหมด', 'รับ', 'จ่าย', 'โอน', 'อาหาร', 'ค่าห้อง', 'กันยายน'] as const;

/**
 * S4 รายการทั้งหมด (design.md §4 S4) — ยังใช้ fixtures รอบนี้ (ต่อ DB เป็นงานถัดไป)
 * ที่เปลี่ยนรอบนี้: ต้องล็อกอินก่อนเข้า และส่งแถวในรูปแบบที่ component แสดงผลต้องการ
 */
export default async function TransactionsPage() {
  await requireSession();

  const rows: TransactionRowView[] = TRANSACTIONS.map((txn) => {
    const category = categoryOf(txn.categoryId);
    return {
      id: txn.id,
      kind: txn.kind,
      amount: txn.amount,
      dateLabel: txn.dateLabel,
      categoryName: category?.name ?? null,
      categoryColor: category?.color ?? null,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex min-h-11 items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">รายการทั้งหมด</h1>
        <p className="text-[13px] leading-[18px] text-text-muted">{MONTH_LABEL}</p>
      </header>

      <div className="flex min-h-14 items-center gap-2 rounded-input border border-border-strong bg-surface px-3">
        <svg className="size-5 shrink-0 text-text-muted" aria-hidden="true">
          <use href="#i-search" />
        </svg>
        {/* label จริง (ไม่ใช้ placeholder ทำหน้าที่แทน label — §5) */}
        <label className="sr-only" htmlFor="q">
          ค้นหารายการจากโน้ตหรือชื่อหมวด
        </label>
        <input
          id="q"
          type="search"
          placeholder="ค้นหาโน้ต/หมวด"
          autoComplete="off"
          className="min-h-11 w-full bg-transparent outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="ตัวกรองรายการ">
        {FILTERS.map((filter, index) => (
          <button
            key={filter}
            type="button"
            aria-pressed={index === 0}
            className={`min-h-11 rounded-btn border px-4 font-semibold ${
              index === 0
                ? 'border-border-strong bg-surface-2 font-bold'
                : 'border-border bg-surface text-text'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      <TransactionList items={rows} />

      <p className="text-[13px] leading-[18px] text-text-muted">
        แสดง {rows.length} รายการล่าสุด · เลื่อนไม่จำกัดแบบ keyset (ไม่ใช้ OFFSET) ในเฟส 2
      </p>
    </div>
  );
}
