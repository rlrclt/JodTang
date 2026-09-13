/**
 * สถานะกำลังโหลดของ /settings/accounts — skeleton 5 แถวโครงเท่าของจริง (spec §5)
 * ห้ามใช้ spinner กลางจอ (design §2)
 */
export default function AccountsLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <header className="flex min-h-11 items-center gap-1">
        <span className="size-11 rounded-input bg-surface-2" />
        <span className="h-6 w-40 rounded-[4px] bg-surface-2" />
      </header>
      <span className="h-14 rounded-card bg-surface-2" />
      <ul className="animate-pulse overflow-hidden rounded-card border border-border bg-surface" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <li key={index} className="border-b border-border px-4 last:border-b-0">
            <div className="flex min-h-14 items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block h-4 w-32 rounded-[4px] bg-surface-2" />
                <span className="mt-1 block h-3 w-24 rounded-[4px] bg-surface-2" />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
