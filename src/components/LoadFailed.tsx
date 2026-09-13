import Link from 'next/link';

import { RetryBar } from '@/components/RetryBar';

/**
 * หน้าที่โหลดข้อมูลไม่ได้ (DB ล่ม/เน็ตขาด) — server component ที่ **ไม่ throw**
 * ใช้เมื่อชั้นข้อมูลตอบว่า "ตรวจไม่ได้" เช่น อ่าน session ไม่ได้ (src/lib/session.ts · gateSession)
 *
 * ทำไมไม่ปล่อยให้ throw ไปให้ error boundary: ระหว่างที่ RSC payload ล้ม เบราว์เซอร์บางจังหวะตกไปที่
 * หน้า 404 ภาษาอังกฤษของ Next ("This page could not be found") ซึ่งขัด design §4 — ผู้ใช้ต้องเห็นข้อความไทย + ปุ่มลองใหม่
 * (error.tsx ยังอยู่เป็นด่านสุดท้ายสำหรับ error ที่คาดไม่ถึง)
 */
export function LoadFailed({ message = 'ต่อข้อมูลไม่ได้ในตอนนี้ — ลองอีกครั้งได้เลย' }: { message?: string }) {
  return (
    <div className="flex flex-col gap-4 pt-6">
      <h1 className="text-2xl font-semibold">โหลดไม่สำเร็จ</h1>
      <p className="text-text-muted">รายการของคุณยังอยู่ครบ ไม่มีอะไรหายไป</p>
      <RetryBar message={message} />
      <Link href="/" className="flex min-h-11 items-center font-semibold text-[var(--balance)]">
        กลับหน้าแรก
      </Link>
    </div>
  );
}
