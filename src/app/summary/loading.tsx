/**
 * สถานะกำลังโหลดของ /summary — โครงเท่าของจริง: หัวเรื่อง+ช่วงเวลา → การ์ดแนวโน้ม → รายจ่ายตามหมวด → เทียบงบ
 * (บล็อกเทียบงบมี Suspense ของตัวเองในหน้า — ที่นี่ใส่โครงการ์ดว่างไว้ให้ความสูงใกล้เคียง)
 */
export default function SummaryLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <header className="flex flex-col gap-1">
        <span className="h-8 w-24 rounded-[4px] bg-surface-2" />
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
          <span className="size-11 rounded-input bg-surface-2" />
          <span className="h-7 w-32 rounded-[4px] bg-surface-2" />
          <span className="size-11 rounded-input bg-surface-2" />
        </div>
      </header>

      <section className="animate-pulse rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]" aria-hidden="true">
        <span className="block h-6 w-40 rounded-[4px] bg-surface-2" />
        <span className="mt-1 block h-4 w-48 rounded-[4px] bg-surface-2" />
        <span className="mt-3 block h-32 w-full rounded-[4px] bg-surface-2" />
      </section>

      <section className="animate-pulse rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]" aria-hidden="true">
        <span className="block h-6 w-44 rounded-[4px] bg-surface-2" />
        <div className="mt-3 flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center gap-3">
              <span className="size-2.5 shrink-0 rounded-pill bg-surface-2" />
              <span className="min-w-0 flex-1">
                <span className="block h-4 w-28 rounded-[4px] bg-surface-2" />
                <span className="mt-1 block h-3 w-20 rounded-[4px] bg-surface-2" />
              </span>
              <span className="h-4 w-20 rounded-[4px] bg-surface-2" />
            </div>
          ))}
        </div>
      </section>

      <section className="animate-pulse rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]" aria-hidden="true">
        <span className="block h-6 w-32 rounded-[4px] bg-surface-2" />
        <span className="mt-3 block h-12 w-full rounded-[4px] bg-surface-2" />
      </section>
    </div>
  );
}
