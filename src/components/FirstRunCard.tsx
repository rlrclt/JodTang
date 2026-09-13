'use client';

import Link from 'next/link';
import { useState } from 'react';

import { announce } from '@/components/announce-store';
import { setupDefaultsAction } from '@/components/entry-actions';

/**
 * การ์ด "เริ่มใช้งานเร็ว" (wave12 §2) — ทำหน้าที่แทนวิซาร์ด S0: 1 แตะได้กระเป๋า + หมวดเริ่มต้น
 * - แสดงเฉพาะผู้ใช้ใหม่จริง (เงื่อนไขอยู่ที่ฝั่ง server: firstRunState = false ทั้งสาม)
 * - ข้ามได้เสมอ: ปุ่มรองเปิดชีตเพิ่มรายการเอง (data-open-add) + ลิงก์ไปตั้งค่าเอง · ไม่บล็อกเส้นทางใด
 * - สำเร็จ = การ์ดหาย (เมื่อ RSC refresh เห็นว่ามีข้อมูลแล้ว) + ประกาศผ่าน <Announcer> ใน layout
 *   (ไม่ประกาศในการ์ดเอง เพราะการ์ดถูกถอดตอน refresh → screen reader ไม่ทันอ่าน) + โฟกัสไปปุ่ม "เพิ่มรายการ"
 */
export function FirstRunCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setup = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await setupDefaultsAction();
      if (!result.ok) {
        setError(result.message); // การ์ดยังอยู่ + กดซ้ำได้ (action กันข้อมูลซ้ำฝั่ง server แล้ว)
        return;
      }
      // ประกาศผ่าน live region ถาวรของ layout — ถ้าประกาศในตัวการ์ด ข้อความจะถูกถอดใน ~39ms
      // ตอน RSC refresh แทนที่ส่วนนี้ (screen reader ไม่ทันประกาศ — บั๊กที่ reviewer วัดไว้)
      announce(result.message);
      // โฟกัสไปปุ่มเพิ่มรายการของแอป (FAB อยู่ใน layout) — หลังการ์ดหาย ผู้ใช้ยังมีทางไปต่อทันที
      requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>('[aria-label="เพิ่มรายการ"]')?.focus();
      });
    } catch {
      setError('สร้างค่าเริ่มต้นไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="first-run-label"
      className="rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]"
    >
      <h2 id="first-run-label" className="text-xl font-semibold">
        เริ่มใช้งานเร็ว
      </h2>
      <p className="mt-1 text-[13px] leading-[18px] text-text-muted">
        สร้างกระเป๋าเงินสด 1 ใบ + หมวดที่ใช้บ่อย 5 หมวด · แก้ทีหลังได้ในหน้าตั้งค่า
      </p>

      <button
        type="button"
        onClick={setup}
        disabled={busy}
        className="mt-3 flex min-h-14 w-full items-center justify-center rounded-btn bg-balance font-bold text-on-accent disabled:opacity-40"
      >
        {busy ? 'กำลังสร้าง…' : 'สร้างค่าเริ่มต้นให้เลย'}
      </button>

      <div className="mt-1 flex items-center justify-between gap-2">
        {/* ปุ่มรอง: เปิดชีตเพิ่มรายการเดิม (AddEntryFab ดักคลิกที่ [data-open-add]) — ไม่ reload */}
        <button type="button" data-open-add className="flex min-h-11 items-center font-semibold text-[var(--balance)]">
          เพิ่มรายการเอง
        </button>
        <Link href="/settings/categories" className="flex min-h-11 items-center font-semibold text-[var(--balance)]">
          ตั้งค่าเอง ›
        </Link>
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-[13px] leading-[18px] text-warn">
          ⚠ {error}
        </p>
      ) : null}
    </section>
  );
}

/** skeleton ระหว่างรอ firstRunState — สูงเท่าการ์ดจริง ไม่ให้ layout กระโดด (design §2) */
export function FirstRunCardSkeleton() {
  return (
    <div className="animate-pulse rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]" aria-hidden="true">
      <div className="h-6 w-32 rounded-[4px] bg-surface-2" />
      <div className="mt-2 h-4 w-full rounded-[4px] bg-surface-2" />
      <div className="mt-3 h-14 w-full rounded-btn bg-surface-2" />
      <div className="mt-1 h-11 w-full rounded-btn bg-surface-2" />
    </div>
  );
}
