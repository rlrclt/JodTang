/* จดจ่าย service worker — design.md §6
 *
 * - cache app shell (หน้าแรก/ตั้งค่า/ไอคอน) เป็นหลัก ไม่แคชข้อมูลการเงินแบบยาว
 * - ข้อมูลที่มียอด (เอกสาร HTML) ใช้ stale-while-revalidate สั้น ๆ → เปิดแอปแล้วเห็นยอดจากแคชก่อน ตัวเลขจริงตามมาทีหลัง
 * - ไม่แตะคำขอเขียนข้อมูล (POST/PUT/PATCH/DELETE) และไม่แคช /api/ (credential/session)
 *
 * ponytail: TTL 60 วิ + ไม่มีคิวออฟไลน์ (design §7: ออฟไลน์ v1 = อ่านอย่างเดียว)
 *   → ถ้าจะเขียนตอนออฟไลน์ ต้องเพิ่มคิว + client_id (idempotency) ที่ฝั่งแอป ไม่ใช่ยัดใน SW
 */
const CACHE = 'jodjai-v1';
const SHELL = ['/', '/settings', '/icons/icon-192.png'];
const DATA_TTL_MS = 60_000;
const STAMP = 'x-sw-cached-at';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // ทีละตัว: ตัวใดพลาด (เช่น ยังไม่ล็อกอิน) ต้องไม่ทำให้ install ล้มทั้งชุด
      await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/**
 * เก็บสำเนาพร้อมเวลาที่แคช (ไว้ตัดสินความสดของข้อมูล)
 * ต้องอ่านสำเนา (clone) แล้วสร้าง Response ใหม่ — ถ้าเอา response.body ตัวเดียวไปทั้ง cache.put และคืนให้เบราว์เซอร์
 * body จะถูกกินไปครึ่งทาง → เบราว์เซอร์ได้ body ว่าง = ERR_FAILED (เจอจริงตอนทดสอบ)
 */
async function put(cache, request, response) {
  const body = await response.clone().arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set(STAMP, String(Date.now()));
  await cache.put(request, new Response(body, { status: response.status, statusText: response.statusText, headers }));
  return response;
}

/** ข้อมูลที่มียอด: ของในแคชยังสด → คืนเลยแล้วค่อยอัปเดตเบื้องหลัง · ไม่สด/ไม่มี → รอเครือข่าย (พลาดค่อยใช้ของเก่า) */
async function staleWhileRevalidate(event, cache) {
  const cached = await cache.match(event.request);
  const fresh = cached ? Date.now() - Number(cached.headers.get(STAMP) ?? 0) < DATA_TTL_MS : false;
  const network = fetch(event.request)
    .then((response) => (response && response.ok ? put(cache, event.request, response) : response))
    .catch(() => null);

  if (cached && fresh) {
    event.waitUntil(network);
    return cached;
  }
  return (await network) ?? cached ?? Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // เขียนข้อมูล = ผ่านเครือข่ายเท่านั้น (อ่านอย่างเดียวตอนออฟไลน์)
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // session/credential ห้ามแคช

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      // หน้าแรกมียอดเดือนนี้ → สั้น ๆ พอ (§6) · หน้าอื่น/ไฟล์ static = cache-first แล้วอัปเดตเบื้องหลัง
      if (request.mode === 'navigate') {
        if (url.pathname === '/') return staleWhileRevalidate(event, cache);
        try {
          const response = await fetch(request);
          if (response.ok) await put(cache, request, response);
          return response;
        } catch {
          return (await cache.match(request)) ?? (await cache.match('/')) ?? Response.error();
        }
      }

      const cached = await cache.match(request);
      if (cached) {
        event.waitUntil(fetch(request).then((response) => (response.ok ? put(cache, request, response) : response)).catch(() => {}));
        return cached;
      }
      try {
        const response = await fetch(request);
        if (response.ok && url.pathname.startsWith('/_next/static/')) await put(cache, request, response);
        return response;
      } catch {
        return Response.error();
      }
    })(),
  );
});
