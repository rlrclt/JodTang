import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware ของ "ยังไม่มีคุกกี้ session" (wave29)
 *
 * ⛔ กติกาเหล็ก: **ตัดสินแค่ "มีคุกกี้ไหม" เท่านั้น — ห้ามใช้ middleware ตัดสินการยืนยันตัวตน**
 * - คุกกี้ปลอม/หมดอายุ = "มีคุกกี้" ⇒ **ปล่อยผ่าน** ให้ `gateSession()` (ที่แตะ DB จริง) เป็นผู้ตัดสิน
 *   (middleware ตรวจ token ไม่ได้ — ไม่มี secret/DB ที่ edge และการเชื่อว่า "มีคุกกี้ = ล็อกอินแล้ว" คือช่องโหว่)
 * - ไม่แตะ DB จึงเร็ว และไม่ทำให้หน้าเว็บช้าลง
 *
 * ทำไมต้องมี: ตั้งแต่เพิ่ม `src/app/loading.tsx` หน้าแรกถูกห่อด้วย Suspense ⇒ shell ถูกส่งทันที (200)
 * แล้ว `redirect('/login')` ของ gate มาทีหลังเป็น client-side redirect ในสตรีม · prod smoke ข้อ 1
 * (และพฤติกรรมที่ผู้ใช้/CI คาดหวัง: คำขอที่ไม่มีคุกกี้เลยควรได้ 307 ไป /login ตั้งแต่ก่อน render)
 * จึงต้องดักที่ชั้น routing ด้วยเงื่อนไขที่ "แคบที่สุด" = ไม่มีคุกกี้เลยเท่านั้น
 *
 * ชื่อคุกกี้: ยืนยันจาก node_modules/better-auth/dist/cookies/index.mjs:264-275
 * - dev (http)          = `better-auth.session_token`
 * - production (https)  = `__Secure-better-auth.session_token`
 * better-auth ยังรับรูปแบบคู่ขนานที่ใช้ `-` แทน `.` (บรรทัด 267) จึงตรวจทั้งสองแบบ
 */
const SESSION_COOKIES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
  'better-auth-session_token',
  '__Secure-better-auth-session_token',
] as const;

export function middleware(request: NextRequest): NextResponse {
  const hasSessionCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSessionCookie) return NextResponse.next();

  // 307 = คง method ไว้ (ไม่ใช่ 302) — ตามที่ prod smoke วัด
  return NextResponse.redirect(new URL('/login', request.url), 307);
}

/**
 * matcher = **รายการเส้นทางที่ต้องล็อกอินเท่านั้น** (whitelist)
 * ทุกอย่างที่ไม่ระบุจะไม่ผ่าน middleware เลย ⇒ ไม่ต้องมี exclude list ที่พลาดได้ง่าย:
 * `/login` (กัน loop) · `/offline` (PWA ต้องเปิดได้ตอนออฟไลน์) · `/export/:path*` (API ที่ต้องตอบ 401 เอง ไม่ใช่ redirect)
 * · `/api/*` · `/_next/*` · ไอคอน/ไฟล์ static · `/manifest.webmanifest` · `/sw.js` · favicon
 * — เส้นทางที่ระบุมี `?add=1`/`?_rsc=` ติดมาก็ยังเข้าเงื่อนไข (matcher ดูที่ pathname) และถ้ามีคุกกี้ก็ผ่านปกติ
 */
export const config = {
  matcher: ['/', '/transactions', '/summary', '/settings', '/settings/:path*'],
};
