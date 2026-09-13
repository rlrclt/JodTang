/* จดจ่าย service worker — design.md §6
 *
 * ⛔ กติกาที่ห้ามละเมิด: **ห้ามแคช HTML ของ route ที่ต้องล็อกอิน** (หน้าแรก/รายการ/สรุป/ตั้งค่า/งบ)
 *    HTML พวกนั้นมีข้อมูลการเงินของผู้ใช้อยู่ในตัว — เคยแคช '/' แบบ stale-while-revalidate แล้วเจอของจริงว่า
 *    สลับบัญชี/ออกจากระบบแล้วยังเสิร์ฟหน้าของ "ผู้ใช้คนก่อน" จาก cache (ข้อมูลรั่วข้ามบัญชี)
 *    → navigation ทุกตัว = network-only (ไม่เก็บ ไม่เสิร์ฟของเก่า) · ที่แคชได้คือ static asset ที่ไม่มีข้อมูลผู้ใช้
 *    ราคาที่จ่าย: ออฟไลน์เปิดหน้าที่มียอดไม่ได้ (ยอมรับ — PLAN §1 "offline shell" หมายถึงโครงแอป ไม่ใช่ข้อมูลการเงิน)
 * - ไม่แตะคำขอเขียนข้อมูล (POST/PUT/PATCH/DELETE) และไม่แคช /api/ (credential/session)
 * - cache สูงสุด: ไฟล์ JS/CSS/ไอคอน/ฟอนต์ เท่านั้น
 *
 * เรื่องการล้าง: ตอน activate จะลบ cache ที่ไม่ใช่ชื่อรุ่นปัจจุบัน (ล้างของเก่าที่ค้างในเครื่องผู้ใช้ทันที)
 * และฝั่งหน้าเว็บล้าง cache storage ตอน sign out / sign in (src/components/AuthButtons.tsx)
 */
const CACHE = 'jodjai-static-v2';
const PRECACHE = ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'];
/** ไฟล์ที่ไม่ขึ้นกับผู้ใช้ — ทุกอย่างนอกจากนี้ไม่แคช */
const STATIC_RE = /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|svg|webp|avif|ico)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // ลบทุก cache ที่ไม่ใช่รุ่นนี้ — ของเดิม (jodjai-v1) มี HTML ที่มียอดเงินของผู้ใช้คนก่อนค้างอยู่
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/** static asset: ของในแคชใช้ได้เลย ไม่มีก็โหลดแล้วเก็บ (ไม่มีข้อมูลผู้ใช้ จึงไม่ต้องกลัวข้ามบัญชี) */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // clone() ก่อนเก็บ: ถ้าใช้ body ตัวเดียวกันทั้ง cache.put และคืนให้เบราว์เซอร์ body จะถูกกินไปครึ่งทาง (ERR_FAILED)
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return cached ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // เอกสาร HTML (รวม navigation ทุกแบบ) = network-only — ห้ามแคช ห้ามเสิร์ฟของเก่า
  if (request.mode === 'navigate' || request.destination === 'document') return;

  if (url.pathname.startsWith('/api/')) return;
  if (!url.pathname.startsWith('/_next/static/') && !STATIC_RE.test(url.pathname)) return;

  event.respondWith(cacheFirst(request));
});
