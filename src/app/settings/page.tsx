import { InstallApp } from '@/components/Pwa';
import { MONTH_LABEL } from '@/lib/fixtures';

// design.md §3 แท็บ 4 (ตั้งค่า) — เฟส 1 ทำแค่โครงให้แท็บไม่พัง
// ของจริงตาม §4 S6: หมวดหมู่ · กระเป๋าเงิน · งบประมาณ · ธีม · ออกจากระบบ
export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">ตั้งค่า</h1>
      <ul className="overflow-hidden rounded-card border border-border bg-surface">
        {['หมวดหมู่', 'กระเป๋าเงิน', 'งบประมาณ', 'ธีม', 'บัญชี/ออกจากระบบ'].map((label) => (
          <li key={label} className="border-b border-border px-4 last:border-b-0">
            <div className="flex min-h-14 items-center justify-between gap-3">
              <span>{label}</span>
              <span className="text-[13px] text-text-muted">เร็ว ๆ นี้</span>
            </div>
          </li>
        ))}
      </ul>
      <section className="rounded-card border border-border bg-surface p-4">
        <h2 className="mb-2 font-semibold">ติดตั้งแอป</h2>
        <InstallApp />
      </section>

      <p className="text-[13px] leading-[18px] text-text-muted">
        เดือนปัจจุบัน: {MONTH_LABEL} · ธีมตามระบบอยู่แล้ว (สลับเองได้ในหน้านี้ตอนต่อ DB)
      </p>
    </div>
  );
}
