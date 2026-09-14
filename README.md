# จดจ่าย (JodJai)

webapp บันทึกรายรับรายจ่ายที่ทำให้ "รู้สึกเหมือนแอป native" บนมือถือ — Next.js 15 (App Router) + TypeScript, Tailwind v4, Drizzle ORM + Postgres (Neon), Better Auth (Google/LINE), PWA

## ฟีเจอร์ที่มีแล้ว

- **บันทึกรายการเร็วสุด 2 แตะ** — bottom sheet + แป้นตัวเลขของแอปเอง · กระเป๋า/หมวดเดาจากที่ใช้ล่าสุด · ยังไม่มีกระเป๋า/หมวดก็สร้างได้จากในชีตเลย · รองรับ โอน ระหว่างกระเป๋า
- **แก้/ลบรายการที่บันทึกแล้ว** — ลบเป็น soft delete และ**กู้คืนได้ที่ถังขยะ** `/settings/trash`
- **หน้าแรก** — ยอดเดือนนี้ (รับ/จ่าย/คงเหลือ) + รายการล่าสุด · สลับเดือนด้วย ‹ › (URL `?m=YYYY-MM-01`)
- **รายการทั้งหมด** `/transactions` — ค้นหา (โน้ต + ชื่อหมวด) · กรอง ประเภท/หมวด/กระเป๋า · **โหมดทุกเดือน `?m=all`** · เลื่อนไม่จำกัดแบบ keyset (ไม่ใช้ OFFSET)
- **สรุป** `/summary` — กราฟรายจ่ายตามหมวด + แนวโน้ม 6 เดือน + เทียบงบต่อหมวด (div/CSS ล้วน ไม่มีไลบรารีกราฟ)
- **งบรายเดือนต่อหมวด** `/settings/budgets` — ตั้ง/แก้/ล้าง (ไม่พกยอดข้ามเดือน)
- **หมวดหมู่ / กระเป๋าเงิน** `/settings/categories` `/settings/accounts` — เพิ่ม/แก้/เลิกใช้ (archive)/กู้คืน · ยอดคงเหลือต่อกระเป๋า
- **ตั้ง/แก้อีเมลของตัวเอง** ใน `/settings` — อีเมลที่ตั้งเองนับเป็น "ยังไม่ยืนยัน" เสมอ (ยังไม่มี flow ส่งอีเมลยืนยัน)
- **ส่งออกข้อมูล** `/settings/export` — CSV (อ่านในชีต) + JSON (สำรอง) · ไม่รวมรายการที่ลบแล้ว · สูงสุด 20,000 แถวต่อครั้ง (เกินแล้วต้องกรองเดือนให้แคบลง)
- **PWA** — ติดตั้งลงหน้าจอโฮม, หน้า `/offline` แบบ static (ไม่แตะ DB), ธีมสว่าง/มืดตามระบบ + สลับเองได้

## เริ่มใช้งาน

```bash
npm install
cp .env.example .env.local   # หรือ .env — Next โหลดทั้งคู่ · รายชื่อตัวแปรอยู่ในไฟล์นั้น
npm run dev
```

- ต้องใช้ **Node ≥ 22.18** (ดู `engines` ใน `package.json`) — เทสต์รันด้วย `npm test` (`node --test src/` กับไฟล์ `.ts` ตรง ๆ ผ่าน type stripping ในตัว Node) ไม่มี vitest/jest
- **ยังไม่มี credential ของ Neon ก็รันได้** — ไม่ตั้ง `DATABASE_URL` แล้วแอปจะต่อ dev DB ให้เอง (PGlite = Postgres จริงบน WASM เก็บที่ `./.pglite`)
- **DB ตอนพัฒนา = Neon branch `dev`** (เครื่องนี้ไม่มี Docker) · migration ใช้ `npm run migrate` และต้องมี `DATABASE_URL_DIRECT` (pooled เป็น PgBouncer รัน DDL ไม่ได้)
- **ตรวจก่อน deploy:** `npm run build` แล้ว `npm run smoke:prod` (ค่าเริ่มต้นยิง `http://127.0.0.1:3000` หรือตั้ง `SMOKE_URL=https://<domain>`)
- ยังไม่เคยทดสอบล็อกอิน Google/LINE บนเครื่องนี้ (ไม่มีคีย์ของผู้ให้บริการ) — โค้ดฝั่ง provider พร้อมแล้วแต่ยังไม่มีหลักฐานรันจริง

## คำสั่งที่ใช้บ่อย

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` / `build` / `start` | รัน dev / build production / รัน production |
| `npm test` | ชุดเทสต์ทั้งหมด (`node --test src/` · node:test + PGlite — ไม่มี vitest/jest) · ต้อง Node ≥22.18 |
| `npm run migrate` | รัน drizzle migration (ต้องมี `DATABASE_URL_DIRECT`) |
| `npm run smoke:prod` | ยิงตรวจ deployment จริง: `/` ไม่ใช่ 5xx และไม่หลุดข้อมูลการเงินตอนไม่มีคุกกี้ · `/login` + ปุ่มผู้ให้บริการ · `/offline` · manifest · header ความปลอดภัย 5 ตัว · โครงสร้าง `sw.js` · `?m=` ไม่ทำ 5xx |
| `npm run lint` | eslint |
| `node scripts/dev-smoke.mjs` | พิสูจน์วงจร DB ครบ (สร้าง → อ่าน → ลบ) โดยไม่ต้องมี credential |
| `node docs/tools/schema_check.mjs` | apply `docs/schema.sql` ลง PGlite จริง + assertion กันของเสีย/ยอดเพี้ยน/ข้ามผู้ใช้ |
| `node docs/tools/catalog_diff.mjs docs/schema.sql drizzle` | เทียบ catalog: `schema.sql` ↔ migration ที่ generate (ต้องตรงกัน) |
| `python3 docs/tools/contrast_check.py` | ตรวจคอนทราสต์โทเคนตาม `docs/design.md` §1.1 (stdlib ล้วน) |

## เอกสาร (แหล่งความจริง)

| ไฟล์ | เนื้อหา |
|---|---|
| `docs/PLAN.md` | แผนโปรเจกต์ v1: ขอบเขต, stack, เฟสงาน, ความเสี่ยง |
| `docs/design.md` | โทเคน (สี/ฟอนต์/radius/shadow), กติกา mobile-native, accessibility, มติ action color |
| `docs/schema.sql` | DDL จริง — เงินเป็น `bigint` สตางค์, soft delete, composite FK กันข้อมูลข้ามบัญชี |
| `docs/drizzle-mapping.md` | `schema.sql` ↔ Drizzle schema (รวมสิ่งที่ drizzle เขียนไม่ได้: INCLUDE/trigger) |
| `docs/SETUP.md` | วิธีขอ credential (Neon, Better Auth, Google, LINE) ทีละขั้น |
| `docs/schema-review.md` · `query-review.md` · `money-review.md` · `mutations-review.md` · `accounts-categories-review.md` | รีวิวที่ผ่านมา (finding + หลักฐานรันจริง) |
| `docs/reports/` | รายงานเฉพาะเรื่อง (เช่น เทียบ schema กับ `better-auth generate`) |
| `docs/tools/` | สคริปต์ตรวจงาน: `contrast_check.py` · `schema_check.mjs` · `catalog_diff.mjs` |
| `docs/theme-preview.html` · `docs/preview-*.png` | ตัวอย่างธีม (ไม่ใช่ธีมแอป — ใช้ดูโทเคนเท่านั้น) |
| `docs/diagrams.html` | ไดอะแกรมสถาปัตยกรรม (พาเลตต์ของเอกสารเอง ไม่ใช่ธีมแอป) |
| `docs/reviews/*.png` | ภาพ UI จริง 390×844 ทั้งธีมมืด/สว่าง |

## กติกาที่ล็อกตาย

- เงินเป็น `bigint` หน่วยสตางค์เสมอ ห้าม float/numeric · คิด/แปลงเงินที่ `src/lib/money.ts` ที่เดียว
- ลบรายการ = `deleted_at` (soft delete) · เลิกใช้กระเป๋า/หมวด = `archived_at` (ไม่ลบจริง)
- กันข้อมูลข้ามบัญชีที่ชั้น DB ด้วย composite FK (`account_id,user_id` / `category_id,kind,user_id`)
- เดือน/ปีคิดตาม `Asia/Bangkok` เสมอ (`src/lib/month.ts`) — ห้ามใช้ `toISOString()`/`getMonth()` กับงวดเดือน
- ลิสต์ยาวใช้ keyset pagination (`occurred_at` + `id`) ไม่ใช้ OFFSET
- ห้ามข้อความ error ที่มีรหัส DB/HTTP ถึงผู้ใช้ — แปลเป็นข้อความไทยที่ชั้น action
- การเงินเป็นทางวิกฤต: ทุก diff ที่แตะการคำนวณเงิน/auth ต้องผ่าน reviewer ก่อน แล้วรันคำสั่งจริงยืนยัน

## โครงสร้าง

```
src/app/         routes (App Router) + server actions + loading.tsx ต่อหน้า
                 • /  /login  /transactions  /summary  /offline
                 • /settings{,/categories,/accounts,/budgets,/trash,/export}
                 • /export/transactions + /export/backup  (route handler ดาวน์โหลด; ต้องล็อกอิน, ตอบ 401)
                 • /api/auth/[...all]  (Better Auth)
src/middleware.ts  ดักเฉพาะ "ไม่มีคุกกี้ session" → 307 /login (ไม่ตัดสินการยืนยันตัวตน — gateSession ทำ)
src/components/  UI ร่วม (bottom sheet, แป้นตัวเลข, แถบงบ, ตัวกรอง, ตัวสลับเดือน)
src/db/          schema · queries · mutations · error helpers · dev DB (PGlite)
src/lib/         money · month · month-url · session · auth · line-profile
drizzle/         migration ที่ generate แล้ว (0000, 0001)
public/          sw.js + ไอคอน PWA
docs/            แผน · ดีไซน์ · DDL · รีวิว · เครื่องมือตรวจ
scripts/         dev-smoke · prod-smoke
```
