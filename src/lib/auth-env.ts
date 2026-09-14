/**
 * ด่านตรวจ env ของ Better Auth — แยกไฟล์เพราะ `src/lib/auth.ts` import ด้วย alias `@/db` (รันด้วย `node --test` ตรง ๆ ไม่ได้)
 * ที่นี่ไม่มี import เลย → เทสต์เข้าได้ และกติกายังอยู่ที่เดียวที่ถูกเรียกใช้จริง
 *
 * ทำไมต้อง fail-fast (audit F3): ถ้า production แล้ว `BETTER_AUTH_URL` ว่างหรือไม่ใช่ https
 *   - cookie ของ session จะไม่ถูกตั้ง `Secure`/`__Secure-` → เสี่ยงถูกดักกลางทาง
 *   - trustedOrigins จะผูกกับ origin ของ request ที่เข้ามา → เปิดช่องให้ปลอม origin
 * ปล่อยผ่านไปแล้วผู้ใช้จะไม่รู้ตัวเลย จนกว่าจะมีคนโจมตี — จึงล้มทันทีตั้งแต่ตอนสร้าง auth instance
 * (dev ไม่ล้ม: http://localhost ใช้ตามปกติได้ · ไฟล์นี้ไม่แตะค่าอื่นของ env)
 */

/** true = production ที่ไม่มี BETTER_AUTH_URL หรือไม่ใช่ https */
export function isInvalidProductionAuthUrl(nodeEnv: string | undefined, authUrl: string | undefined): boolean {
  if (nodeEnv !== 'production') return false;
  return !authUrl || !authUrl.startsWith('https://');
}

/** ช่วง `next build` (static generation) ไม่ได้เสิร์ฟ traffic จริง — Next ตั้ง NEXT_PHASE ให้เอง */
const BUILD_PHASE = 'phase-production-build';

/**
 * โยน Error ข้อความไทยถ้า production ตั้ง BETTER_AUTH_URL ผิด (dev = ไม่ทำอะไร)
 *
 * ข้ามช่วง `next build`: ตอนนั้นยังไม่มี request จริง และถ้า throw ที่นี่ หน้าเว็บจะถูกจัดเป็น static
 * (เพราะ `getAuth()` ล้มก่อน `headers()` จะถูกเรียก) = ได้ผลลัพธ์ที่หลอกตา · ปล่อยให้ล้มตอน request แรกของ production แทน
 * (ยังเป็น fail-fast แบบไม่เงียบ — ข้อความบอกตรง ๆ ว่าต้องตั้งอะไร)
 */
export function assertProductionAuthUrl(
  nodeEnv: string | undefined,
  authUrl: string | undefined,
  nextPhase: string | undefined = process.env.NEXT_PHASE,
): void {
  if (nextPhase === BUILD_PHASE) return;
  if (!isInvalidProductionAuthUrl(nodeEnv, authUrl)) return;
  throw new Error(
    'BETTER_AUTH_URL ต้องเป็น https:// เท่านั้นใน production (เช่น https://jodjai.example.com) ' +
      '— ถ้าว่างหรือเป็น http cookie ของ session จะไม่ถูกตั้ง Secure และ trustedOrigins จะผูกกับ request',
  );
}
