/* จดจ่าย service worker — design.md §6 · PLAN §1 (offline shell)
 *
 * ⛔ กติกาที่ห้ามละเมิด: **ห้ามแคช HTML ของ route ที่ต้องล็อกอิน** (หน้าแรก/รายการ/สรุป/ตั้งค่า/งบ)
 *    HTML พวกนั้นมีข้อมูลการเงินของผู้ใช้อยู่ในตัว — เคยแคช '/' แบบ stale-while-revalidate แล้วเจอของจริงว่า
 *    สลับบัญชี/ออกจากระบบแล้วยังเสิร์ฟหน้าของ "ผู้ใช้คนก่อน" จาก cache (ข้อมูลรั่วข้ามบัญชี)
 *    → navigation ทุกตัว = network-only (ไม่เก็บ ไม่เสิร์ฟของเก่า) · ที่แคชได้คือ static asset ที่ไม่มีข้อมูลผู้ใช้
 * - เอกสาร HTML ที่แคชเก็บล่วงหน้าได้มี /offline เท่านั้น (static ล้วน ไม่แตะ DB/session/ข้อมูลผู้ใช้ — src/app/offline/page.tsx)
 *    route อื่นที่ไม่มีข้อมูลผู้ใช้ (/login) ก็ปลอดภัยในทางหลักการ แต่ไม่ได้เก็บล่วงหน้า เพราะไม่ได้ต้องใช้ตอนออฟไลน์
 *    ⚠️ ถ้าจะเพิ่มเอกสารลง PRECACHE: ต้องพิสูจน์ก่อนว่า HTML นั้นไม่มีข้อมูลผู้ใช้/ข้อมูลการเงินแม้แต่ตัวเดียว
 * - ออฟไลน์แล้วเปิด route ที่ต้องล็อกอิน (fetch ของ navigation ยิงไม่ถึง) → ส่งผู้ใช้ไป /offline ที่แคชไว้
 *    **ไม่ใช่**การแคชหน้านั้น: ไม่มี HTML ของ route ใดถูกเก็บลง cache เลยแม้แต่ครั้งเดียว
 *    ทำไมต้อง 302 (ไม่เสิร์ฟเนื้อ /offline ใต้ URL เดิม): วัดจริงบน production แล้ว ถ้าเสิร์ฟเอกสารของ /offline
 *    ตอน URL เป็น /transactions ตัว router ฝั่ง client จะเห็น URL ไม่ตรงกับ RSC payload แล้วแทนเนื้อหาทั้งหน้า
 *    ด้วย error boundary ("โหลดไม่สำเร็จ") — ผู้ใช้จึงไม่ได้เห็นหน้า offline ที่ตั้งใจ
 *    → 302 ไป /offline?from=<path เดิม> ให้ URL ตรงกับเอกสาร แล้วปุ่ม "ลองใหม่" พาไป path นั้นต่อ
 * - ไม่แตะคำขอเขียนข้อมูล (POST/PUT/PATCH/DELETE) และไม่แคช /api/ (credential/session)
 * - cache สูงสุด: ไฟล์ JS/CSS/ไอคอน/ฟอนต์ + เอกสาร /offline เท่านั้น (ตอน install จะดึง asset ของ /offline เอง
 *    ตามรายการใน HTML ของมัน เพื่อให้หน้า offline เปิดขึ้นมาแล้วใช้งานได้จริง — asset ไม่มีข้อมูลผู้ใช้)
 *
 * เรื่องการล้าง: ตอน activate จะลบ cache ที่ไม่ใช่ชื่อรุ่นปัจจุบัน (ล้างของเก่าที่ค้างในเครื่องผู้ใช้ทันที)
 * และฝั่งหน้าเว็บล้าง cache storage ตอน sign out / sign in (src/components/AuthButtons.tsx)
 */
const CACHE = 'jodjai-static-v4';
/** หน้าเดียวที่แคชเก็บล่วงหน้าได้ — static ล้วน ไม่มีข้อมูลผู้ใช้ (ใช้เป็น fallback ของ navigation ที่ยิงไม่ถึง) */
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'];
/** ไฟล์ที่ไม่ขึ้นกับผู้ใช้ — ทุกอย่างนอกจากนี้ไม่แคช */
const STATIC_RE = /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|svg|webp|avif|ico)$/i;

/**
 * แคชหน้า /offline + **asset ของมันเอง** ให้เปิดได้จริงตอนออฟไลน์
 * ชื่อไฟล์ JS/CSS มี hash เปลี่ยนทุกรุ่น → อ่านรายการจาก HTML จริงตอนติดตั้ง (ไม่มี manifest ให้ใช้ ไม่พึ่ง dependency ใหม่)
 * เอาเฉพาะแท็ก src=/href= ที่ชี้ /_next/static/ — ไม่กวาดสตริงใน RSC payload (มี escape ติดมาได้) และไม่แตะ HTML ของ route อื่น
 */
async function precacheOffline(cache) {
  const response = await fetch(OFFLINE_URL, { cache: 'reload' });
  if (!response.ok) return;

  await cache.put(OFFLINE_URL, response.clone());
  const html = await response.text();

  const assets = [...html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]*)"/g)].map((m) => m[1]);
  await Promise.all([...new Set(assets)].map((url) => cache.add(url).catch(() => undefined)));

  // ฟอนต์ถูกอ้างใน CSS ไม่ใช่ใน HTML → สแกนต่ออีกหนึ่งชั้น (จำกัดที่ /_next/static/ เท่านั้น)
  const styles = [...new Set(assets.filter((url) => url.endsWith('.css')))];
  await Promise.all(
    styles.map(async (url) => {
      const css = await cache.match(url);
      if (!css) return;
      const text = await css.text();
      const fonts = [...text.matchAll(/url\(\s*['"]?([^)'"]*\/_next\/static\/[^)'"]*)/g)].map((m) => m[1]);
      await Promise.all([...new Set(fonts)].map((font) => cache.add(font).catch(() => undefined)));
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
      await precacheOffline(cache);
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

/**
 * navigation: ยิงเน็ตเท่านั้น — **ไม่แคชเอกสารของผู้ใช้เลยแม้แต่ครั้งเดียว**
 * ยิงไม่ถึง (ออฟไลน์/เน็ตหลุด) → ส่งไป /offline ที่แคชไว้ · เซิร์ฟเวอร์ตอบ 5xx = ปล่อยผ่าน (ไม่กลบ error จริงด้วยหน้า offline)
 */
async function networkOnlyNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const url = new URL(request.url);

    // ขอ /offline อยู่แล้ว → เสิร์ฟจากแคชตรง ๆ (ห้าม 302 ไปหาตัวเอง = วนไม่จบ)
    // ignoreSearch: /offline?from=... ต้องได้เอกสารเดียวกัน
    if (url.pathname === OFFLINE_URL) {
      return (await caches.match(OFFLINE_URL, { ignoreSearch: true })) ?? Response.error();
    }

    // ขอ route อื่น: ให้ URL ตรงกับเอกสาร (เหตุผลในหัวไฟล์) + จำปลายทางเดิมไว้ให้ปุ่ม "ลองใหม่"
    const target = new URL(OFFLINE_URL, self.location.origin);
    target.searchParams.set('from', `${url.pathname}${url.search}`);
    return Response.redirect(target.href, 302);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // เอกสาร HTML (รวม navigation ทุกแบบ) = network-only — ห้ามแคช ห้ามเสิร์ฟของเก่า (ออฟไลน์ค่อยตกไปที่ /offline)
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkOnlyNavigation(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) return;
  if (!url.pathname.startsWith('/_next/static/') && !STATIC_RE.test(url.pathname)) return;

  event.respondWith(cacheFirst(request));
});
