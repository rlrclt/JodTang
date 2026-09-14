# จดจ่าย (JodJai) — แผนโปรเจกต์ v1

webapp รายรับรายจ่าย · mobile-first · รู้สึกเหมือนแอป native
สถานะ: เริ่มพัฒนาแล้ว — ฟีเจอร์ v1 (§1) ทำงานจริงครบ ดูรายการที่มีจริงและคำสั่งรันที่ README.md (บรรทัดนี้เดิมเขียนว่า "รออนุมัติแผน (ยังไม่เริ่มเขียนโค้ด)")
ไฟล์ที่เกี่ยวข้อง: `docs/diagrams.html` (ไดอะแกรม) · `docs/design.md` (theme + UX จาก architect) · `docs/schema.sql` (DDL จริง)

---

## 1. ขอบเขต v1 (ทำ / ไม่ทำ)

ทำ
- ล็อกอิน Google หรือ LINE
- บันทึกรายรับ/รายจ่าย เร็วสุด 2 แตะ (จำนวน → บันทึก, หมวดเดาจากรายการเดิม)
- หน้าแรก: ยอดเดือนนี้ (รับ/จ่าย/คงเหลือ) + รายการล่าสุด
- รายการทั้งหมด: ค้นหา + กรองตามเดือน/หมวด/ประเภท
- สรุป: กราฟรายจ่ายตามหมวด + แนวโน้ม 6 เดือน
- จัดการหมวดหมู่เองได้, ตั้งงบประมาณต่อเดือนต่อหมวด
- ติดตั้งลงหน้าจอมือถือได้ (PWA)

ไม่ทำใน v1 (ใส่เมื่อขอ)
- บัญชีใช้ร่วมกันในครอบครัว / หลาย workspace
- หลายสกุลเงินจริง (เก็บ currency ได้ แต่ล็อก THB)
- เชื่อมธนาคาร / OCR สลิป / นำเข้า CSV
- push notification, รายการประจำ (recurring), export PDF

---

## 2. Stack ที่เลือก

| ชั้น | เลือก | ทำไม |
|---|---|---|
| แอป | Next.js 15 (App Router) + TypeScript | server component = JS ฝั่ง client น้อย (สำคัญบนมือถือไทย), PWA ง่าย, deploy Vercel |
| สไตล์ | Tailwind CSS v4 | เขียน utility ไม่ต้องตั้ง design system เอง, purge อัตโนมัติ |
| Auth | Better Auth | มี provider `line` ในตัว + Google, ใช้ Drizzle adapter ได้, self-host ไม่มีค่ารายหัว |
| DB | Postgres บน Neon (free tier) | serverless Postgres, มี branching แยก dev/prod |
| ORM | Drizzle + drizzle-kit | typed, SQL ตรงไปตรงมา, bundle เล็ก |
| PWA | manifest + service worker | ติดตั้งลง home screen, standalone ไม่มีแถบเบราว์เซอร์ |
| Host | Vercel (frontend+API) + Neon (DB) | ฟรีพอสำหรับ v1 |

ไม่เลือก / ตัดออก
- Supabase — ไม่จำเป็น เพราะเอา Better Auth + Neon พอ และไม่ผูกกับ schema ของเจ้า
- Prisma — หนักกว่า ต้อง generate client, Drizzle พอ
- Expo / React Native — ต้องการ webapp ที่ "รู้สึก" native ไม่ใช่แอป native จริง ไม่คุ้มค่า build store
- shadcn/ui — component เยอะเกินจำเป็น v1 เขียนเองเฉพาะที่ใช้ (bottom sheet, ปุ่ม, การ์ด)
- Chart library — v1 กราฟแท่ง/โดนัททำด้วย div + CSS พอ ใส่ recharts เมื่อต้องการ interactivity จริง
- Docker — เครื่อง dev นี้ไม่มี docker, dev ใช้ Neon branch ตรงๆ ได้เลย

Env ที่ต้องมี

```
DATABASE_URL=            # pooled (ใช้ในแอป)
DATABASE_URL_DIRECT=     # direct (ใช้ drizzle-kit migrate เท่านั้น)
BETTER_AUTH_SECRET=      # openssl rand -base64 32
BETTER_AUTH_URL=https://<domain>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
LINE_CLIENT_ID=
LINE_CLIENT_SECRET=
```

หมายเหตุ dev: เครื่องนี้ไม่มี `psql`/`sqlite3` → ใช้ Neon branch (dev) เป็น DB ตอนพัฒนา, migration ใช้ `DATABASE_URL_DIRECT` เสมอ (pooled เป็น PgBouncer โหมด transaction ทำ DDL ไม่ได้)

---

## 3. สมัครสมาชิก / ล็อกอิน (Google + LINE)

โค้ดหลัก (Better Auth)

```ts
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    line: {
      clientId: process.env.LINE_CLIENT_ID!,
      clientSecret: process.env.LINE_CLIENT_SECRET!,
    },
  },
});
```

```ts
// src/app/api/auth/[...all]/route.ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
export const { GET, POST } = toNextJsHandler(auth);
```

Callback URL ที่ต้องกรอกในคอนโซลเจ้า

- Google Cloud Console → `https://<domain>/api/auth/callback/google` (และ `http://localhost:3000/api/auth/callback/google` สำหรับ dev)
- LINE Developers → LINE Login channel → callback `https://<domain>/api/auth/callback/line`

จุดที่ต้องระวัง (ของจริง ไม่ใช่ทฤษฎี)

1. **LINE ไม่ให้อีเมลมาโดยอัตโนมัติ** — ต้องสร้าง channel แบบ LINE Login แล้ว "ขอสิทธิ์เข้าถึงอีเมล" แยกอีกขั้น และรออนุมัติ ถ้ายังไม่อนุมัติ ผู้ใช้ล็อกอินได้แต่ไม่มีอีเมล → ออกแบบ `user.email` เป็น nullable และมีหน้า "กรอกอีเมลภายหลัง" ไม่บังคับตอนสมัคร
2. **LINE แยก channel ตามประเทศ** — channel ของไทยใช้กับผู้ใช้ไทย ถ้าอนาคตจะรองรับ JP/TW ต้องเพิ่ม channel และใช้ generic OAuth plugin ตั้ง `providerId` แยก (`line-th`, `line-jp`)
3. **อีเมลจาก LINE ไม่ถือว่ายืนยันแล้ว** — Better Auth ตั้ง `emailVerified: false` ให้ อย่าใช้เป็นกุญแจเชื่อมบัญชีข้าม provider โดยไม่เช็ค กันกรณีคนอื่นอ้างอีเมลคุณ
4. CSRF/PKCE/state: Better Auth จัดการให้อยู่แล้ว ไม่ต้องเขียนเอง
5. ฝั่ง client ใช้ `authClient.signIn.social({ provider: "line", callbackURL: "/" })` และ `"google"`

---

## 4. ฐานข้อมูล

DDL จริงอยู่ที่ `docs/schema.sql` (แหล่งความจริงเดียว) สรุปโครง:

- `user`, `session`, `account`, `verification` — ของ Better Auth (account ผูก provider google/line + access token)
- `accounts` — กระเป๋าเงินของผู้ใช้ (เงินสด, ธนาคาร, บัตร) ใช้โอนระหว่างกัน
- `categories` — หมวด รายรับ/รายจ่าย ของผู้ใช้เอง มี icon + สี
- `transactions` — หัวใจ: kind (income/expense/transfer), account_id, to_account_id (เฉพาะโอน), category_id, amount, occurred_at, note, deleted_at
- `budgets` — งบต่อเดือนต่อหมวด (`period_month` เป็น date วันแรกของเดือน, unique ต่อ user+category+เดือน)

กติกาที่ล็อกตาย

- เงินเก็บเป็น `bigint` หน่วย **สตางค์** เสมอ ห้าม float/numeric กับเงิน (0.1+0.2 problem กับเงินคือบั๊กจริง)
- `currency char(3) default 'THB'` — เก็บไว้แต่ v1 ไม่แปลงข้ามสกุล
- `occurred_at timestamptz` (เวลาเกิดรายการ ไม่ใช่เวลา insert) — สรุปเดือนต้องตัดตาม timezone ผู้ใช้ v1 ล็อก `Asia/Bangkok` (ตาราง user_settings ยังไม่ทำใน v1)
- ลบรายการ = `deleted_at` (soft delete) ทุก query ต้องกรอง `deleted_at is null` · กระเป๋า/หมวดที่เลิกใช้ = `archived_at`
- กันข้อมูลรั่วข้ามบัญชีที่ชั้น DB: FK แบบ composite `(account_id, user_id)` / `(category_id, kind, user_id)` — แม้แอปมีบั๊กก็อ้างของคนอื่นไม่ได้
- ตรวจว่า DDL รันได้จริงด้วย `node docs/tools/schema_check.mjs` (PGlite = Postgres จริงใน WASM) มี assertion เรื่องยอดรวม, soft delete, ข้ามผู้ใช้, kind ไม่ตรง
- ทุกตารางมี `user_id` + index ที่ใช้จริงกับหน้าแรก/หน้าสรุป (ดูใน schema.sql)

---

## 5. Theme + ความรู้สึก mobile-native

รายละเอียดทั้งหมดอยู่ที่ `docs/design.md` สรุปแนวทาง:

- โทน: พื้นมืด/สว่างคู่กัน, สีเขียว = รายรับ, สีแดง/ส้ม = รายจ่าย, สีน้ำเงิน = คงเหลือ (ไม่ใช้สีอย่างเดียวสื่อความหมาย — ใส่ +/- ด้วย เพื่อคนตาบอดสี) และสีน้ำเงินใช้เป็นพื้นทึบของปุ่ม/FAB (action) — แดง/เขียวบอกทิศทางเงินเท่านั้น ห้ามใช้เป็นสีปุ่ม/error
- ฟอนต์ไทย: LINE Seed Sans TH หรือ IBM Plex Sans Thai (โหลด subset, ไม่ใช้ฟอนต์ 5 น้ำหนัก)
- ตัวเลขเงิน: ฟอนต์ tabular-nums เพื่อให้หลักตรงกัน
- กติกา native feel: `safe-area-inset` บน/ล่าง, bottom tab bar 4 แท็บ, ปุ่ม/แถวสูง ≥ 44px, ใช้ bottom sheet ไม่ใช้ modal กลางจอ, คีย์แพดตัวเลขเองสำหรับกรอกจำนวน (ไม่เรียก keyboard ระบบ), haptic (`navigator.vibrate`) ตอนบันทึก, optimistic UI ตอนเพิ่มรายการ, `viewport-fit=cover` + `overscroll-behavior: none`, ห้ามมี page reload
- state: ทุกหน้ามี ว่าง / กำลังโหลด (skeleton ไม่ใช่ spinner) / error + ปุ่มลองใหม่

---

## 6. แผนงาน + ใครทำอะไร

| เฟส | งาน | เจ้าของ | เสร็จเมื่อ |
|---|---|---|---|
| 0 (ตอนนี้) | theme + schema + ไดอะแกรม | architect + lead | คุณอนุมัติ |
| 1 | scaffold Next.js + Tailwind + Drizzle + Better Auth (Google/LINE ล็อกอินได้จริง) | coder → reviewer | ล็อกอินด้วย Google และ LINE ได้บนเครื่อง dev |
| 2 | CRUD รายการ + หน้าแรก + หมวดหมู่ | coder → reviewer | เพิ่ม/แก้/ลบรายการแล้วยอดเดือนนี้ถูกต้อง |
| 3 | สรุป/กราฟ + budgets + PWA install + polish (sheet, haptic) | coder | ติดตั้งลงมือถือได้ ใช้งานได้ offline shell |
| 4 | acceptance: build + lint + เดิน flow จริงบนจอ 390px | verifier | รายงานผ่าน/ไม่ผ่านพร้อม output จริง |

กติกา: การเงินเป็นทางวิกฤต — ทุก diff ที่แตะการคำนวณเงิน/การยืนยันตัวตนต้องผ่าน reviewer ก่อน แล้ว verifier รันคำสั่งจริง ไม่มีอะไรผ่านด้วยคำบอกเล่า

---

## 7. ต้องตัดสินใจจากคุณ (ตอบมาแล้วผมเดินต่อ)

1. **ชื่อแอป/โดเมน** — ตอนนี้ใช้ชื่อ "จดจ่าย" และ placeholder domain, ถ้ามีโดเมนจริงบอกได้
2. **ขอสิทธิ์อีเมลจาก LINE ไหม** — ต้องยื่นคำขอและรออนุมัติ (ถ้าไม่งั้นผู้ใช้ LINE จะไม่มีอีเมลในระบบ)
3. **บังคับล็อกอินก่อนใช้ หรือให้ลองใช้แบบ local ก่อนค่อยล็อก** — ผมแนะนำบังคับล็อกอิน เพราะข้อมูลการเงินควรผูกบัญชีตั้งแต่แรก

---

## 8. ความเสี่ยง

- LINE email permission ต้องรออนุมัติจาก LINE — ตัวบล็อกจริงถ้าต้องการอีเมล
- PWA บน iOS: ติดตั้งได้ แต่ push ต้อง iOS 16.4+ และผู้ใช้ต้อง add to home screen เอง — v1 ไม่พึ่ง push
- Neon cold start ทำให้ครั้งแรกช้าเล็กน้อย — ยอมรับได้ใน v1
- ถ้าจะทำ recurring/แจ้งเตือนภายหลัง ต้องมี background job (Vercel cron) — ยังไม่ทำ
