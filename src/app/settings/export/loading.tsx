/** สถานะกำลังโหลดของ /settings/export — โครงเท่าของจริง: หัวเรื่อง+ปุ่มกลับ → คำอธิบาย → ปุ่มดาวน์โหลด 2 ปุ่ม */
export default function ExportLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <header className="flex min-h-11 items-center gap-1">
        <span className="size-11 rounded-input bg-surface-2" />
        <span className="h-8 w-40 rounded-[4px] bg-surface-2" />
      </header>
      <section className="flex flex-col gap-2">
        <span className="h-6 w-32 rounded-[4px] bg-surface-2" />
        <span className="block h-40 w-full rounded-card bg-surface-2" />
      </section>
      <section className="flex flex-col gap-2">
        <span className="h-6 w-24 rounded-[4px] bg-surface-2" />
        <span className="block h-14 w-full rounded-card bg-surface-2" />
        <span className="block h-4 w-56 rounded-[4px] bg-surface-2" />
        <span className="block h-14 w-full rounded-card bg-surface-2" />
        <span className="block h-4 w-56 rounded-[4px] bg-surface-2" />
      </section>
    </div>
  );
}
