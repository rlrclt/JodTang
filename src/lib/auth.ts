import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth, line } from 'better-auth/plugins/generic-oauth';

import { getDb } from '@/db';
import { account, session, user, verification } from '@/db/schema';
import { assertProductionAuthUrl } from './auth-env';
import { mapLineProfileToUser } from './line-profile';

/**
 * Better Auth (1.7.4) — Google ผ่าน socialProviders, LINE ผ่าน genericOAuth plugin
 * (เวอร์ชันนี้ไม่มี socialProviders.line: ตัวช่วย line() อยู่ใน generic-oauth/providers/line.mjs)
 * credential ทั้งหมดอ่านจาก env เท่านั้น (รายชื่อใน .env.example · วิธีขอใน docs/SETUP.md)
 */
function createAuth() {
  // fail-fast เฉพาะ production (audit F3) — dev ใช้ http://localhost ตามปกติ ดู src/lib/auth-env.ts
  assertProductionAuthUrl(process.env.NODE_ENV, process.env.BETTER_AUTH_URL);

  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    /**
     * เข้ารหัส access/refresh/id token ของ Google/LINE ก่อนเก็บลง DB (audit F2)
     * ทำไม: ตอนนี้ถ้าฐานข้อมูลรั่ว ผู้โจมตีเอา token ไปใช้ต่อกับผู้ให้บริการได้ทันที (token = กุญแจ ไม่ใช่รหัสผ่าน)
     * Better Auth เข้ารหัสด้วย `secretConfig` ที่มาจาก BETTER_AUTH_SECRET (ถอดกลับได้ตอนอ่าน) — ไม่กระทบ schema เดิม
     */
    account: { encryptOAuthTokens: true },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      },
    },
    plugins: [
      genericOAuth({
        config: [
          /** LINE (genericOAuth): helper `line()` รับได้เฉพาะ option มาตรฐาน → เติม mapProfileToUser ที่ผลลัพธ์ */
          {
            ...line({
              providerId: 'line',
              clientId: process.env.LINE_CLIENT_ID ?? '',
              clientSecret: process.env.LINE_CLIENT_SECRET ?? '',
              /**
               * default scope ของตัวช่วยนี้คือ ['openid','profile','email'] — เราตัด email ออกก่อน
               * เพราะ LINE ยังไม่อนุมัติสิทธิ์อีเมล (docs/SETUP.md §3.4) ขอไปเลยอาจล็อกอินไม่ผ่าน
               * ไม่ใช่แค่ได้ null
               * ⚠ ผลที่ตามมา (เดิมทำให้ล็อกอิน LINE ไม่ได้เลย): โปรไฟล์ที่ไม่มีอีเมลถูก better-auth ปฏิเสธ
               *   → ทางแก้คือ mapProfileToUser ด้านล่าง (อีเมลตัวแทน <sub>@line.local + emailVerified false)
               * · วันที่ LINE อนุมัติ ให้เพิ่ม 'email' ที่นี่ที่เดียว — map ยังใช้ค่าจริงเมื่อมีมาให้ (ทำงานได้สองทาง)
               */
              scopes: ['openid', 'profile'],
            }),
            /**
             * LINE ที่ไม่ขอสโคป email จะไม่คืนอีเมล → better-auth ปฏิเสธ callback ด้วย
             * "Provider "line" did not return an email … or create a placeholder via mapProfileToUser"
             * = ผู้ใช้ LINE ล็อกอินไม่ได้เลย · mapLineProfileToUser() สร้างอีเมลตัวแทนที่เสถียรต่อ sub
             * และคืน emailVerified: false เสมอ · กติกา/เหตุผลทั้งหมดอยู่ในคอมเมนต์หัวไฟล์ src/lib/line-profile.ts
             */
            mapProfileToUser: mapLineProfileToUser,
          },
        ],
      }),
    ],
  });
}

let cached: ReturnType<typeof createAuth> | undefined;

/**
 * สร้าง instance ตอน "เรียกใช้ครั้งแรก" ไม่ใช่ตอน import
 * เหตุผล: `next build` เก็บ page data ของทุก route → โมดูลนี้ถูกโหลดบนเครื่องที่ยังไม่มี credential
 * ถ้าสร้างตอน import จะล้ม (ต่อ DB / อ่าน secret) · ตอน runtime env ที่หายไปยังล้มเสียงดังที่ request แรก
 */
export function getAuth() {
  cached ??= createAuth();
  return cached;
}
