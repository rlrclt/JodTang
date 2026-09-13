# จดจ่าย (JodJai)

webapp บันทึกรายรับรายจ่ายที่ทำให้ "รู้สึกเหมือนแอป native" บนมือถือ — Next.js 15 (App Router) + TypeScript, Tailwind v4, Drizzle ORM + Postgres (Neon), Better Auth (Google/LINE), PWA

## เริ่มใช้งาน

```bash
npm install
cp .env.example .env.local   # เติมค่า (ดู docs/SETUP.md)
npm run dev
```

ยังไม่มี credential ของ Neon ก็รันได้ — ไม่ตั้ง `DATABASE_URL` แล้วแอปจะต่อ dev DB ให้เอง (PGlite = Postgres จริงบน WASM เก็บที่ `./.pglite`) ดู docs/SETUP.md §"ทางลัด"

```bash
node scripts/dev-smoke.mjs   # พิสูจน์วงจร DB ครบ (สร้าง → อ่าน → ลบ)
npm run build                # production build
```

## เอกสาร (แหล่งความจริง)

| ไฟล์ | เนื้อหา |
|---|---|
| `docs/PLAN.md` | แผนโปรเจกต์ v1: ขอบเขต, stack, เฟสงาน, ความเสี่ยง |
| `docs/design.md` | โทเคนธีม (สี/radius/ฟอนต์), กติกา native feel, accessibility, มติ action color |
| `docs/schema.sql` | DDL จริง — เงินเป็น `bigint` หน่วยสตางค์, soft delete, composite FK กันข้อมูลข้ามบัญชี |
| `docs/SETUP.md` | วิธีขอ credential (Neon, Better Auth, Google, LINE) ทีละขั้น |
| `docs/drizzle-mapping.md` | schema.sql ↔ Drizzle schema |
| `docs/reviews/*.png` | ภาพ UI 390×844 ทั้งธีมมืด/สว่าง |

## กติกาที่ล็อกตาย

- เงินเป็น `bigint` หน่วยสตางค์เสมอ ห้าม float/numeric
- ลบรายการ = `deleted_at` (soft delete) · เลิกใช้กระเป๋า/หมวด = `archived_at`
- กันข้อมูลข้ามบัญชีที่ชั้น DB ด้วย composite FK
- เดือน/ปีคิดตาม `Asia/Bangkok` เสมอ (`src/lib/month.ts`)
- การเงินเป็นทางวิกฤต: ทุก diff ที่แตะการคำนวณเงิน/auth ต้องผ่าน reviewer ก่อน แล้วรันคำสั่งจริงยืนยัน

## โครงสร้าง

```
src/app/         route (App Router) + server actions
src/components/  UI ที่ใช้ร่วม (bottom sheet, แป้นตัวเลข, แถบงบ)
src/db/          schema · queries · mutations · error helpers · dev DB (PGlite)
src/lib/         money · month · session · auth
drizzle/         migration ที่ generate แล้ว
docs/            แผน · ดีไซน์ · DDL · คู่มือตั้งค่า · รีวิว
scripts/         สคริปต์ตรวจงาน (dev-smoke)
```
