import { categoryOf, type FixtureTxn } from '@/lib/fixtures';
import { formatRowAmount } from '@/lib/money';

const KIND_LABEL = { income: 'รับ', expense: 'จ่าย', transfer: 'โอน' } as const;

/**
 * แถวในลิสต์ — design.md §1.3 (สูง 56) · §2 (ทั้งแถวเป็น <button> แตะได้ ≥ 44 ไม่ใช่ div+onClick)
 * ตัวเลขเงิน: เครื่องหมาย +/- มาจาก formatRowAmount() ที่เดียว · สีอย่างเดียวไม่ใช้สื่อความหมาย (มีคำ รับ/จ่าย/โอน กำกับ)
 */
export function TransactionRow({ txn }: { txn: FixtureTxn }) {
  const category = categoryOf(txn.categoryId);
  const amountColor =
    txn.kind === 'income' ? 'text-income' : txn.kind === 'expense' ? 'text-expense' : 'text-[var(--balance)]';

  return (
    <li className="border-b border-border last:border-b-0">
      <button type="button" className="flex min-h-14 w-full items-center gap-3 px-2 text-left">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-pill"
          style={{ background: category ? `var(${category.color})` : 'var(--balance)' }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{category?.name ?? KIND_LABEL[txn.kind]}</span>
          <span className="block truncate text-[13px] leading-[18px] text-text-muted">
            {txn.dateLabel} · {KIND_LABEL[txn.kind]}
          </span>
        </span>
        <span className={`num font-semibold ${amountColor}`}>{formatRowAmount(txn)}</span>
      </button>
    </li>
  );
}

/** ลิสต์แถวรายการ (ผู้เรียกใส่ <ul> เองเพื่อคุมหัวข้อ/label) */
export function TransactionList({ items }: { items: readonly FixtureTxn[] }) {
  return (
    <ul className="overflow-hidden rounded-card border border-border bg-surface">
      {items.map((txn) => (
        <TransactionRow key={txn.id} txn={txn} />
      ))}
    </ul>
  );
}
