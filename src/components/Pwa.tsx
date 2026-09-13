'use client';

import { useEffect, useState } from 'react';

/**
 * PWA ของจดจ่าย (design.md §6) — รวมไว้ไฟล์เดียว เล็กพอที่จะไม่ต้องมีโฟลเดอร์
 * - ลงทะเบียน service worker (จาก public/sw.js) · แถบ "ออฟไลน์อยู่" ทุกหน้าจอ
 * - ออฟไลน์ v1 = อ่านอย่างเดียว: แถบเตือน + ปุ่มบันทึกถูก disable (คิวออฟไลน์ยังไม่ทำ — §7)
 * - Android: เก็บ event beforeinstallprompt ไว้ให้หน้าตั้งค่ากดเอง (ไม่เด้งเอง) · iOS: บอกวิธีสั้น ๆ
 */

/** ปุ่มติดตั้งของ Chrome/Android (ไม่ใช่มาตรฐาน — ประกาศชนิดเอง) */
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * ล้าง cache storage ทั้งหมดของ origin นี้ — เรียกตอน sign out และก่อน sign in
 * เหตุผล: เครื่องที่เคยล็อกอินบัญชีหนึ่งต้องไม่มีของค้างที่อาจถูกเสิร์ฟให้บัญชีถัดไป
 * (service worker แคชแต่ static asset แล้ว แต่การล้างเป็นตาข่ายชั้นที่สอง — ของเก่าจาก SW รุ่นก่อนยังอยู่ในเครื่องผู้ใช้)
 * ล้มได้โดยไม่ทำให้ flow ล็อกอิน/ออกล้มตาม
 */
export async function clearCacheStorage(): Promise<void> {
  if (!('caches' in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch (error) {
    console.error('[jodjai] ล้าง cache ไม่สำเร็จ:', error);
  }
}

/**
 * สถานะออฟไลน์ของอุปกรณ์
 * ponytail: ใช้ navigator.onLine + event online/offline (ไม่ยิง ping เพราะเปลืองแบต/เน็ต)
 *   → เน็ตหลอก (ต่อ WiFi ได้แต่ไม่มีเน็ตจริง) จะยังขึ้นออนไลน์ · เริ่มค่า false เพื่อไม่ให้ SSR/CSR ไม่ตรงกัน
 */
export function useOffline(): boolean {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => {
      removeEventListener('online', update);
      removeEventListener('offline', update);
    };
  }, []);

  return offline;
}

/** ลงทะเบียน SW + แถบออฟไลน์ (ติดทุกหน้าจอจาก layout) */
export function OfflineBar() {
  const offline = useOffline();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // เงียบเมื่อล้ม: SW พังต้องไม่ทำให้แอปพัง (ออฟไลน์เป็นของแถม ไม่ใช่ทางหลัก)
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-30 flex items-center gap-2 bg-warn px-4 py-2 text-[13px] font-semibold text-on-accent"
    >
      <span aria-hidden="true">●</span>
      ออฟไลน์อยู่ · แสดงข้อมูลที่แคชไว้ · บันทึกรายการใหม่ยังไม่ได้
    </div>
  );
}

/** ปุ่มติดตั้งแอป / วิธีติดตั้งบน iOS — ใช้ในหน้าตั้งค่า (§4 S6) */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setStandalone(matchMedia('(display-mode: standalone)').matches);
    setIos(/iP(hone|ad|od)/.test(navigator.userAgent));

    const onPrompt = (event: Event) => {
      event.preventDefault(); // ไม่เด้งเอง — เก็บไว้ให้ผู้ใช้กดในหน้าตั้งค่า
      setPrompt(event as InstallPrompt);
    };
    addEventListener('beforeinstallprompt', onPrompt);
    addEventListener('appinstalled', () => setPrompt(null));
    return () => removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  };

  if (standalone) {
    return <p className="text-[13px] leading-[18px] text-text-muted">ติดตั้งแล้ว — เปิดจากไอคอนบนหน้าจอโฮมได้เลย</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {prompt ? (
        <button type="button" onClick={install} className="min-h-11 self-start rounded-btn border border-border-strong px-4 font-semibold">
          ติดตั้งแอป
        </button>
      ) : null}
      {ios ? (
        <p className="text-[13px] leading-[18px] text-text-muted">
          บน iPhone/iPad: กดปุ่ม <span className="font-semibold">แชร์</span> ใน Safari แล้วเลือก{' '}
          <span className="font-semibold">เพิ่มไปยังหน้าจอโฮม</span>
        </p>
      ) : null}
      {!prompt && !ios ? (
        <p className="text-[13px] leading-[18px] text-text-muted">
          เปิดด้วย Chrome บน Android (หรือ Safari บน iOS) แล้วติดตั้งจากเมนูเบราว์เซอร์
        </p>
      ) : null}
    </div>
  );
}
