/**
 * สถานะกำลังโหลดของหน้าแรก (/) — skeleton ที่มีโครงเท่าของจริง: หัวเดือน → การ์ดยอด → ลิสต์รายการล่าสุด
 * ไม่มี spinner กลางจอ (design §2) · skeleton ไม่ได้แทนพื้นที่การ์ด "เริ่มใช้งานเร็ว"
 * (การ์ดนั้นมี Suspense ของตัวเองในหน้า — ถ้าใส่ skeleton ที่นี่ด้วยจะกะพริบสองจังหวะ)
 */
export default function HomeLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <header className="flex min-h-11 items-center justify-between gap-2">
        <span className="size-11 rounded-input bg-surface-2" />
        <span className="h-7 w-32 rounded-[4px] bg-surface-2" />
        <span className="size-11 rounded-input bg-surface-2" />
      </header>

      <span className="h-4 w-40 rounded-[4px] bg-surface-2" />

      <section className="animate-pulse rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]" aria-hidden="true">
        <span className="block h-3 w-28 rounded-[4px] bg-surface-2" />
        <span className="mt-2 block h-9 w-40 rounded-[4px] bg-surface-2" />
        <div className="mt-3 flex gap-6">
          <span className="h-4 w-24 rounded-[4px] bg-surface-2" />
          <span className="h-4 w-24 rounded-[4px] bg-surface-2" />
        </div>
      </section>

      <div className="flex items-center justify-between gap-2">
        <span className="h-6 w-28 rounded-[4px] bg-surface-2" />
        <span className="h-4 w-16 rounded-[4px] bg-surface-2" />
      </div>

      <ul className="animate-pulse overflow-hidden rounded-card border border-border bg-surface" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
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
