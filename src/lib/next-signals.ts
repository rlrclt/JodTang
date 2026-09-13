/**
 * สัญญาณควบคุมของ Next ที่ "ไม่ใช่ error" — ห้ามกลืน ห้าม log เป็น error
 *
 * ทำไมต้องมี: ตอน `next build` Next ลอง prerender ทุก route · route ที่เรียก `headers()`/`cookies()`
 * จะถูกโยน `DynamicServerError` (digest `DYNAMIC_SERVER_USAGE`) เป็น **สัญญาณ** ให้เลิกลองแบบ static
 * ถ้า catch ของเรากลืนสัญญาณนี้ จะเกิด 2 อย่าง: (1) build log มี error ที่ไม่ใช่ error ของเรา
 * (แบนเนอร์ build ไม่เป็น 0 ตามเกณฑ์ PLAN §4) (2) พฤติกรรมตอน build เพี้ยน เพราะเราตอบหน้า error แทนที่จะปล่อยสัญญาณ
 *
 * เช่นเดียวกัน `redirect()`/`notFound()` ของ Next ทำงานด้วยการโยน error พิเศษ — ถ้ากลืนจะกลายเป็น
 * "โหลดไม่สำเร็จ" เงียบ ๆ แทนที่จะพาไปหน้าที่ถูกต้อง
 *
 * ใช้แพตเทิร์น digest (ค่าเดียวกับที่ Next ใช้เอง) ไม่ import internal path ของ Next ซึ่งเปลี่ยนได้ทุกเวอร์ชัน
 */
const CONTROL_FLOW_DIGESTS = [
  'DYNAMIC_SERVER_USAGE', // headers()/cookies() ตอน prerender
  'NEXT_REDIRECT', // redirect() — digest มี suffix ต่อท้าย เช่น 'NEXT_REDIRECT;replace;/login;307;'
  'NEXT_NOT_FOUND', // notFound()
  'NEXT_HTTP_ERROR_FALLBACK', // forbidden()/unauthorized()
  'BAILOUT_TO_CLIENT_SIDE_RENDERING', // useSearchParams() ใน CSR bailout
] as const;

/** true = error นี้เป็นสัญญาณควบคุมของ Next ไม่ใช่ความล้มเหลวจริง → ต้อง `throw error` ต่อทันที */
export function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null | undefined)?.digest;
  return typeof digest === 'string' && CONTROL_FLOW_DIGESTS.some((prefix) => digest.startsWith(prefix));
}
