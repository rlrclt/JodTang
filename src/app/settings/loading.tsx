/**
 * สถานะกำลังโหลดของ /settings — โครงเท่าของจริง: หัวเรื่อง → การ์ดบัญชี → ลิสต์ทางลัด 6 แถว
 * แถวสูง 56px เท่าของจริง (min-h-14) เพื่อไม่ให้หน้าจอกระโดดตอนเนื้อหามา
 */
export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="h-8 w-24 rounded-[4px] bg-surface-2" />

      <section className="flex flex-col gap-2">
        <span className="h-6 w-16 rounded-[4px] bg-surface-2" />
        <div className="rounded-card border border-border bg-surface px-4">
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="block h-4 w-28 rounded-[4px] bg-surface-2" />
              <span className="mt-1 block h-3 w-40 rounded-[4px] bg-surface-2" />
            </div>
            <span className="h-11 w-24 shrink-0 rounded-btn bg-surface-2" />
          </div>
        </div>
      </section>

      <ul className="animate-pulse overflow-hidden rounded-card border border-border bg-surface" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4 last:border-b-0">
            <span className="h-4 w-28 rounded-[4px] bg-surface-2" />
            <span className="h-4 w-20 rounded-[4px] bg-surface-2" />
          </li>
        ))}
      </ul>
    </div>
  );
}
