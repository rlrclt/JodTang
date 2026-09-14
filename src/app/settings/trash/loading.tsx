/**
 * สถานะกำลังโหลดของ /settings/trash — skeleton ที่มีโครงเท่าของจริง 5 แถว (ข้อเสนอ §3)
 * ห้ามใช้ spinner กลางจอ (design.md §2): โครงเดิมทำให้ layout ไม่กระโดด
 * (แอนิเมชันถูกปิดอัตโนมัติเมื่อ prefers-reduced-motion — globals.css)
 */
export default function TrashLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <header className="flex min-h-11 items-center gap-1">
        <span className="size-11 rounded-input bg-surface-2" />
        <span className="h-6 w-48 rounded-[4px] bg-surface-2" />
      </header>
      <span className="h-4 w-64 rounded-[4px] bg-surface-2" />
      <ul className="animate-pulse overflow-hidden rounded-card border border-border bg-surface" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <li key={index} className="border-b border-border px-2 last:border-b-0">
            <div className="flex min-h-14 items-center gap-3">
              <span className="size-2.5 shrink-0 rounded-pill bg-surface-2" />
              <span className="min-w-0 flex-1">
                <span className="block h-4 w-32 rounded-[4px] bg-surface-2" />
                <span className="mt-1 block h-3 w-24 rounded-[4px] bg-surface-2" />
              </span>
              <span className="h-11 w-20 shrink-0 rounded-btn bg-surface-2" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
