'use client';

/**
 * ปุ่ม "ลองใหม่" ของหน้า /offline (design.md §2: ปุ่มหลัก ≥44px เต็มความกว้าง)
 *
 * ปลายทาง: service worker 302 มาจากหน้าที่ผู้ใช้ตั้งใจเปิด พร้อมส่ง `?from=<path เดิม>` มาด้วย
 * → ปุ่มนี้พากลับไป path นั้น (ถ้าออนไลน์แล้วได้หน้าจริงทันที · ยังออฟไลน์ก็กลับมาหน้านี้)
 *
 * เงื่อนไขการยอมรับ `from` (ต้องผ่าน **ทั้งสองข้อ** ไม่ผ่าน = reload หน้านี้):
 *   1. ต้องเป็น path ในเว็บนี้เท่านั้น — ขึ้นต้นด้วย `/` และไม่ใช่ `//host` (protocol-relative)
 *      ข้อนี้กันรูปที่ตาเห็นไม่เหมือนที่ parser คิด เช่น `/\evil.example` (parser แปลง `\` เป็น `/` → `//evil.example`)
 *   2. origin ที่ parse จริงต้องเป็น origin เดียวกัน (`new URL(from, location.origin)`)
 * `from` ที่ผิดรูป/ไม่ใช่ path (เช่น `abc`, `''`, `http://[`) จึงตกไป reload ไม่ถูกประกอบเป็น path เอง (ผู้ใช้จะไม่เจอ 404 งง ๆ)
 *
 * ห้ามอ่านค่าตอน render (location ไม่มีฝั่ง server) — อ่านใน handler เท่านั้น
 */
export function OfflineRetry() {
  const retry = () => {
    const from = new URLSearchParams(location.search).get('from');
    if (from !== null && from.startsWith('/') && !from.startsWith('//')) {
      try {
        const target = new URL(from, location.origin);
        if (target.origin === location.origin) {
          location.assign(target.href);
          return;
        }
      } catch {
        // from ที่ parse ไม่ได้ → ตกไป reload
      }
    }
    location.reload();
  };

  return (
    <button
      type="button"
      onClick={retry}
      className="flex min-h-14 w-full items-center justify-center rounded-[8px] bg-balance px-4 text-[15px] font-semibold text-on-accent"
    >
      ลองใหม่
    </button>
  );
}
