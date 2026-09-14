/**
 * สถานะกำลังโหลดของ /transactions — โครงเท่าของจริง: หัวเรื่อง + แถบช่วงเวลา + ช่องค้นหา + ชิปกรอง + ลิสต์
 * (ห้าม spinner กลางจอ — design §2)
 */
export default function TransactionsLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <header className="flex flex-col gap-1">
        <span className="h-8 w-40 rounded-[4px] bg-surface-2" />
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
          <span className="size-11 rounded-input bg-surface-2" />
          <span className="h-7 w-32 rounded-[4px] bg-surface-2" />
          <span className="size-11 rounded-input bg-surface-2" />
          <span className="h-11 w-20 rounded-btn bg-surface-2" />
        </div>
      </header>

      <span className="block min-h-14 rounded-input border border-border-strong bg-surface-2" />

      <div className="flex flex-wrap gap-2" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className="h-11 w-16 rounded-btn bg-surface-2" />
        ))}
      </div>

      <ul className="animate-pulse overflow-hidden rounded-card border border-border bg-surface" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <li key={index} className="border-b border-border px-2 last:border-b-0">
            <div className="flex min-h-14 items-center gap-3">
              <span className="size-2.5 shrink-0 rounded-pill bg-surface-2" />
              <span className="min-w-0 flex-1">
                <span className="block h-4 w-32 rounded-[4px] bg-surface-2" />
                <span className="mt-1 block h-3 w-24 rounded-[4px] bg-surface-2" />
              </span>
              <span className="h-4 w-20 rounded-[4px] bg-surface-2" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
