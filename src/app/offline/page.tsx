/**
 * S-offline: หน้า /offline (PLAN §1 "ใช้งานได้ offline shell")
 *
 * ⛔ กติกาความปลอดภัย: หน้านี้ **static ล้วน** — ไม่แตะ DB, ไม่เรียก session, ไม่มีข้อมูลผู้ใช้แม้แต่บาทเดียว
 *    จึงเป็นหน้าเดียว (นอกจาก /login) ที่ service worker แคชไว้ล่วงหน้าได้
 *    ถ้าวันหนึ่งมีคนอยากให้หน้านี้แสดงยอด/ชื่อผู้ใช้ = ผิดกติกา sw.js ทันที (cache จะเสิร์ฟข้อมูลข้ามบัญชี)
 */
import type { Metadata } from 'next';

import { OfflineRetry } from '@/components/OfflineRetry';

export const metadata: Metadata = {
  title: 'ออฟไลน์อยู่ · จดจ่าย',
  robots: { index: false },
};

export default function OfflinePage() {
  return (
    <section className="rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
      <h1 className="text-xl font-semibold">ตอนนี้ออฟไลน์อยู่</h1>
      <p className="mt-1 text-[13px] leading-[18px] text-text-muted">
        จดจ่ายเก็บข้อมูลการเงินไว้บนเซิร์ฟเวอร์ (ไม่เก็บยอดไว้ในเครื่อง) จึงอ่านยอดและรายการตอนออฟไลน์ไม่ได้
      </p>
      <p className="mt-1 text-[13px] leading-[18px] text-text-muted">
        ข้อมูลไม่หาย — พอกลับมาออนไลน์ กด “ลองใหม่” เพื่อเปิดหน้าที่ค้างไว้ได้เลย
      </p>
      <div className="mt-4">
        <OfflineRetry />
      </div>
    </section>
  );
}
