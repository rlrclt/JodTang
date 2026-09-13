'use client';

import { useSyncExternalStore } from 'react';

import { currentAnnouncement, subscribe } from '@/components/announce-store';

/**
 * ช่องประกาศถาวรของแอป (wave13b) — วาง **ครั้งเดียวใน layout** ซึ่งไม่ถูก RSC refresh แทนที่
 *
 * บั๊กเดิม: ข้อความยืนยันถูก render ในส่วนที่ refresh แทนที่ → หายจาก DOM ใน ~39ms → screen reader ไม่ทันประกาศ
 * ที่นี่ใช้ `useSyncExternalStore` อ่านจาก store กลาง · `sr-only` = ไม่กินพื้นที่/ไม่เห็นด้วยตา
 * ข้อความล้างเองตาม TTL ใน `announce()` (และถูกแทนที่เมื่อมีข้อความใหม่) → ไม่ค้างผิดบริบท
 */
export function Announcer() {
  const message = useSyncExternalStore(subscribe, currentAnnouncement, currentAnnouncement);

  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
