import { formatRowAmount, type TxnKind } from '@/lib/money';

const KIND_LABEL = { income: 'รับ', expense: 'จ่าย', transfer: 'โอน' } as const;

/**
 * แถวสำหรับแสดงผล — หน้าจอ resolve ชื่อ/สีหมวดจาก DB แล้วส่งเข้ามาสำเร็จรูป
 * component นี้จึงไม่รู้จัก DB และไม่คำนวณเงินเอง (กติกา src/lib/money.ts)
 */
export type TransactionRowView = {
  id: string;
  kind: TxnKind;
  amount: number;
  /** ป้ายวันที่สั้นในแถว — สร้างด้วย dayLabel() ที่เดียว */
  dateLabel: string;
  /** null = ไม่มีหมวด (โอน) → ใช้คำตาม kind */
  categoryName: string | null;
  /** ชื่อโทเคนสี เช่น '--chart-6' (null = สีคงเหลือ) */
  categoryColor: string | null;
  /** หมวดนี้เลิกใช้แล้ว — รายการเก่ายังอ้างถึงได้ ต้องบอกให้เห็น (minor 4e) */
  categoryArchived: boolean;
};

const DAY_LABEL = new Intl.DateTimeFormat('th-TH', {
  // PLAN ล็อกเวลาไทยทุกการแสดงผล (เหตุผลเดียวกับ src/lib/month.ts: เครื่อง dev ไม่ใช่ไทย)
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
});

/** ป้ายวันที่สั้นของแถว '13 ก.ย.' — ที่เดียวที่แปลง Date เป็นป้ายวันที่ของลิสต์ */
export const dayLabel = (occurredAt: Date): string => DAY_LABEL.format(occurredAt);

/**
 * แถวในลิสต์ — design.md §1.3 (สูง 56) · §2 (ทั้งแถวเป็น <button> แตะได้ ≥ 44 ไม่ใช่ div+onClick)
 * ตัวเลขเงิน: เครื่องหมาย +/- มาจาก formatRowAmount() ที่เดียว · สีอย่างเดียวไม่ใช้สื่อความหมาย (มีคำ รับ/จ่าย/โอน กำกับ)
 */
export function TransactionRow({ view }: { view: TransactionRowView }) {
  const amountColor =
    view.kind === 'income' ? 'text-income' : view.kind === 'expense' ? 'text-expense' : 'text-[var(--balance)]';

  return (
    <li className="border-b border-border last:border-b-0">
      {/* ทั้งแถวเป็นการกระทำเดียว: แตะ = เปิดชีตโหมดแก้ ( listener อยู่ที่ AddEntryFab — ใช้ได้ทั้งหน้าแรกและ /transactions) */}
      <button
        type="button"
        data-open-edit={view.id}
        aria-haspopup="dialog"
        aria-label={`แก้รายการ ${view.categoryName ?? KIND_LABEL[view.kind]} ${formatRowAmount(view)}`}
        className="flex min-h-14 w-full items-center gap-3 px-2 text-left"
      >
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-pill"
          style={{
            background: view.categoryColor ? `var(${view.categoryColor})` : 'var(--balance)',
            // หมวดที่เลิกใช้แล้วหรี่จุดสีลง (สื่อด้วยคำในบรรทัดล่างด้วย ไม่ใช่สีอย่างเดียว — §1.1)
            opacity: view.categoryArchived ? 0.5 : 1,
          }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{view.categoryName ?? KIND_LABEL[view.kind]}</span>
          <span className="block truncate text-[13px] leading-[18px] text-text-muted">
            {view.dateLabel} · {KIND_LABEL[view.kind]}
            {view.categoryArchived ? ' · เลิกใช้แล้ว' : ''}
          </span>
        </span>
        <span className={`num font-semibold ${amountColor}`}>{formatRowAmount(view)}</span>
      </button>
    </li>
  );
}

/** ลิสต์แถวรายการ (ผู้เรียกใส่ <ul> เองเพื่อคุมหัวข้อ/label) */
export function TransactionList({ items }: { items: readonly TransactionRowView[] }) {
  return (
    <ul className="overflow-hidden rounded-card border border-border bg-surface">
      {items.map((view) => (
        <TransactionRow key={view.id} view={view} />
      ))}
    </ul>
  );
}
