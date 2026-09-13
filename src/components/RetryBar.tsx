'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * แถบ error ที่ **ไม่ลบข้อมูลเดิม** — บอกว่าโหลด/อัปเดตไม่สำเร็จ + ปุ่มลองใหม่ (design.md §4)
 * ใช้ router.refresh() ไม่ reload หน้า (§2) · ไม่มีรหัส DB/HTTP หลุดถึงผู้ใช้
 */
export function RetryBar({ message = 'อัปเดตไม่สำเร็จ' }: { message?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      role="status"
      className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-border bg-surface px-4"
    >
      <p className="text-[13px] leading-[18px] text-warn">⚠ {message}</p>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        className="min-h-11 shrink-0 rounded-btn border border-border-strong px-4 font-semibold disabled:opacity-40"
      >
        {pending ? 'กำลังลอง…' : 'ลองใหม่'}
      </button>
    </div>
  );
}
