'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * error boundary ของทุกหน้า (design.md §4 S2–S6)
 * - ข้อความไทยล้วน + ปุ่ม "ลองใหม่" · ไม่โชว์รหัส DB/HTTP (เก็บที่ log ฝั่ง server เท่านั้น)
 * - ครอบกรณี "อ่าน session ไม่ได้เพราะ DB ล่ม" ด้วย → ไม่กลายเป็น 500 เปล่า และ **ไม่เด้งไป /login**
 *   (การเด้งไป /login จะทำให้ผู้ใช้เข้าใจผิดว่าตัวเองถูกออกจากระบบ ทั้งที่แค่ต่อ DB ไม่ได้)
 * - ไม่มี `global-error.tsx` เพราะ root layout ไม่แตะ DB (มีแต่ client component) — error ระดับ layout จึงไม่เกิดจากข้อมูล
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[jodjai] หน้าเว็บโหลดไม่สำเร็จ:', error);
  }, [error]);

  return (
    <div className="flex flex-col gap-4 pt-6">
      <h1 className="text-2xl font-semibold">โหลดไม่สำเร็จ</h1>
      <p className="text-text-muted">ต่อข้อมูลไม่ได้ในตอนนี้ — รายการของคุณยังอยู่ครบ ลองอีกครั้งได้เลย</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="min-h-14 flex-1 rounded-btn bg-balance font-bold text-on-accent"
        >
          ลองใหม่
        </button>
        <Link
          href="/"
          className="flex min-h-14 items-center rounded-btn border border-border-strong px-4 font-semibold"
        >
          กลับหน้าแรก
        </Link>
      </div>
    </div>
  );
}
