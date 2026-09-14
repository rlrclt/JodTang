# drizzle mapping — `schema.ts` ⇄ `docs/schema.sql`

ทำไมมีไฟล์นี้: เฟส 1 มีเกณฑ์รับว่า "`npx drizzle-kit generate` แล้ว diff กับ `docs/schema.sql`" ถ้าไม่มีใครระบุว่า *อะไรต่างได้ อะไรต่างไม่ได้* เกณฑ์นี้จะกลายเป็นเถียงกันเรื่องชื่อ constraint
ค่าทั้งหมดในไฟล์นี้ **รันจริง** ด้วย drizzle-orm **0.45.2** + drizzle-kit **0.31.10** (ติดตั้งชั่วคราวใต้ `/tmp` ตอนวัด แล้วลบทิ้ง — ไม่ได้แตะโปรเจกต์) — ไม่ได้อ่านจากเอกสารแล้วเดา

กติกาพื้นฐาน: `docs/schema.sql` = แหล่งความจริง · `schema.ts` ต้อง generate ออกมา **เทียบเท่า** · โฟลเดอร์ **`drizzle/`** (ค่า `out` ใน `drizzle.config.ts`) คือผลลัพธ์ ไม่ใช่ต้นฉบับ (ห้ามแก้ migration มือ ยกเว้นบล็อก INCLUDE และ trigger ที่ระบุในข้อ 2)

## 1) สิ่งที่ drizzle เขียนได้ครบ (ทดสอบแล้ว generate ออกมาตรงกับ DDL เรา)

| ของใน DDL | เขียนใน drizzle | หมายเหตุ |
|---|---|---|
| `bigint` หน่วยสตางค์ | `bigint('amount', { mode: 'number' })` | `mode: 'number'` ปลอดภัยเมื่อมี check เพดาน 1e15 (น้อยกว่า `Number.MAX_SAFE_INTEGER`) — **ห้ามใช้ `mode: 'bigint'` ปน** เพราะจะได้คนละชนิดตอนอ่าน |
| `char(3)` | `char('currency', { length: 3 })` | ออกมาเป็น `char(3)` จริง |
| `timestamptz` + `default now()` | `timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow()` | ต้องมี `withTimezone: true` ทุกตัว ไม่งั้นได้ `timestamp` เปล่า = เทียบเวลาผิด |
| generated column (งวดเดือนไทย) | `date('occurred_month_bkk').generatedAlwaysAs(sql\`(date_trunc('month', occurred_at at time zone interval '7 hours'))::date\`)` | generate ออกมาเป็น `... GENERATED ALWAYS AS (...) STORED` ตรงเป๊ะ · **ห้ามใส่ค่านี้ตอน insert/update** |
| composite FK (กันข้ามผู้ใช้/kind ไม่ตรงหมวด) | `foreignKey({ columns: [t.categoryId, t.kind, t.userId], foreignColumns: [categories.id, categories.kind, categories.userId] })` | ออกมาเป็น FK 3 คอลัมน์ตามต้องการ |
| `check` (amount, currency, btrim(name), รูปแบบ transfer) | `check('transactions_shape_ck', sql\`case when ... end\`)` | ชื่อ constraint ที่เราตั้งเองถูกคงไว้ |
| partial unique index (`where archived_at is null` + `lower(btrim(name))`) | `uniqueIndex('...').on(t.userId, sql\`lower(btrim(${t.name}))\`).where(sql\`archived_at is null\`)` | ออกมาเป็น `CREATE UNIQUE INDEX ... WHERE archived_at is null` ตรง |
| index เรียงย้อนหลัง (หน้าแรก) | `index('...').on(t.userId, t.occurredAt.desc(), t.id.desc()).where(sql\`deleted_at is null\`)` | ได้ `DESC NULLS LAST` (ดูข้อ 3) |

## 2) สิ่งที่ drizzle ทำไม่ได้ — ต้องเติมด้วย SQL มือ (2 เรื่อง)

### 2.1 trigger + function `jodjai_touch_updated_at` (พิสูจน์ด้วย harness ข้อ 4)
drizzle-kit ไม่รู้จัก trigger และ function เลย — `schema.ts` เขียนไม่ได้ และ `generate` จะไม่ออกมาให้ทั้ง 4 trigger + ฟังก์ชัน `jodjai_touch_updated_at()`
ผลถ้าไม่เติม: `updated_at` จะไม่ถูกอัปเดตเองอีกต่อไป (แถวที่แก้จะยังโชว์เวลาเดิม — บั๊กเงียบที่หาสาเหตุยากเพราะไม่มี error)
วิธีทำ: ก๊อปบล็อก `create or replace function ... $$;` + `create trigger ... 4 บรรทัด` จาก `docs/schema.sql` ต่อท้ายไฟล์ migration

### 2.2 index ที่มี INCLUDE

**`index(...).include(...)` ไม่มีใน drizzle-orm 0.45.2**
รันแล้วได้: `TypeError: (0, import_pg_core.index)(...).on(...).include is not a function` (drizzle-kit อ่าน schema.ts ไม่ผ่าน = generate ล้มทั้งรอบ)

ผลกระทบ: 3 index ของเรามี `INCLUDE` และทั้งหมดเป็นตัวที่ทำให้หน้าสรุปเป็น index-only scan (Heap Fetches 0 ตามที่ reviewer วัดไว้) — ห้ามปล่อยหาย

วิธีทำ (เลือกทางนี้): ใน `schema.ts` เขียน index แบบไม่มี `.include()` ตามปกติ แล้วเติม SQL ของ INCLUDE ในไฟล์ migration ที่ generate ออกมา *ต่อท้ายไฟล์ก่อน statement-breakpoint สุดท้าย* หรือสร้าง custom migration:

```sql
-- หลัง create index ปกติแล้ว ให้ drop+create ตัวที่มี INCLUDE (ทำในไฟล์ migration เดียวกัน)
drop index if exists transactions_user_month_idx;
create index transactions_user_month_idx on transactions (user_id, occurred_month_bkk)
  include (amount, kind) where deleted_at is null;
drop index if exists transactions_user_kind_time_idx;
create index transactions_user_kind_time_idx on transactions (user_id, kind, occurred_at)
  include (amount) where deleted_at is null;
drop index if exists transactions_user_category_time_idx;
create index transactions_user_category_time_idx on transactions (user_id, category_id, occurred_at)
  include (amount) where deleted_at is null;
```

ทางเลือกที่ *ไม่* เลือก: ยอมให้ index ไม่มี INCLUDE (หน้าสรุปจะตกจาก index-only scan เป็น index scan + heap fetch — ช้ากว่าแต่ยังทำงานได้) → ตัดสินใจตอนนี้ว่าไม่ยอม เพราะวัดผลไว้แล้วว่าคุ้ม

## 3) ที่ "ต่างได้" — ใส่เป็นรายการยกเว้นของ acceptance ไม่ใช่บั๊ก

| ความต่าง | ตัวอย่างจริง | ทำไมยอมรับได้ |
|---|---|---|
| ชื่อ constraint ที่ PG ตั้งให้เอง | DDL/PG: `session_user_id_fkey` (PG ตั้งให้จาก `references "user"(id)` แบบ inline) · drizzle: `session_user_id_user_id_fk` (`drizzle/0000_mighty_vulture.sql:131`) | ชื่อไม่มีความหมายต่อพฤติกรรม · **FK ที่แอปต้องอ้างชื่อเอง (composite 4 ตัว) ไม่ใช่ตัวอย่างของความต่าง** — `src/db/schema.ts` ตั้งชื่อให้ตรง DDL แล้ว จึงออกมาเป็น `transactions_account_id_user_id_fkey` ฯลฯ เหมือนกัน (`drizzle/0000:129,133-135`) |
| `DESC NULLS LAST` vs `DESC` | drizzle ใส่ `NULLS LAST` ให้เอง | คอลัมน์นั้น `not null` → ไม่มีความต่างเชิงพฤติกรรม |
| ลำดับ statement / การจัดกลุ่ม `ALTER TABLE` | drizzle แยก FK ไปเป็น `ALTER TABLE` ท้ายไฟล์ | ผลลัพธ์บน DB เหมือนกัน |
| comment ในไฟล์ SQL | migration ไม่มี comment อะไรเลย | เราใช้ `--` inline ไม่ได้ใช้ `COMMENT ON` จึงไม่มีข้อมูลหาย |

## 4) acceptance ที่เชื่อได้จริง (ใช้แทนการ "diff ข้อความ SQL")

**เครื่องมือพร้อมแล้วและอยู่ในเรป: `docs/tools/catalog_diff.mjs`** (พิสูจน์ตัวเองด้วย `--selftest` · รันจาก **รากโปรเจกต์** ไม่ต้องตั้ง env)

```bash
node docs/tools/catalog_diff.mjs --selftest docs/schema.sql   # ต้องขึ้น "selftest ผ่าน — ตัวเทียบเชื่อได้"
node docs/tools/catalog_diff.mjs docs/schema.sql drizzle      # งานจริง: ต้อง exit 0 + "catalog ตรงกันทั้งหมด"
node docs/tools/schema_check.mjs                              # ตรวจ schema.sql เดี่ยว ๆ: apply ลง PGlite + assertion
```

`drizzle` ในคำสั่งคือ **โฟลเดอร์ `out` ของ drizzle-kit** = `./drizzle` ตาม `drizzle.config.ts` (ไม่ใช่ `./migrations`)

เทียบ 5 ชั้นโดย apply ของจริงลง Postgres 2 ตัว (PGlite): ตาราง/คอลัมน์ (ชนิด, not null, default, generated) · constraint (primary/unique/foreign/check) · index (คอลัมน์, INCLUDE, predicate, unique) · trigger · function
ผ่านเมื่อ exit 0 และขึ้น `catalog ตรงกันทั้งหมด` · รายการที่ต่างจะถูกพิมพ์พร้อมเหตุผลว่าขาดใน B หรือเกินใน B
`--selftest` พิสูจน์ว่าเครื่องมือจับของที่หายได้จริง: ตัด `include` 3 ตัว + trigger 4 ตัวออกจากสำเนาแล้วต้องรายงานครบ 3+4 และชั้นอื่นไม่ต่าง
ทั้งสองสคริปต์ใช้ PGlite ในหน่วยความจำ — **ไม่แตะข้อมูลจริงและไม่ต้องมี credential**

การเทียบข้อความ SQL ไม่มีคุณค่า (ชื่อ/ลำดับต่างกันทันที) ให้เทียบ **catalog ของ DB 2 ตัว**:

1. DB A: apply `docs/schema.sql` แบบตรง ๆ
2. DB B: apply `drizzle-kit` migrations ทั้งหมด
3. เทียบ: ตาราง/คอลัมน์/ชนิด/ไม่-null/default · `pg_constraint` (kind, columns, expression) · `pg_indexes` (คอลัมน์, include, predicate, unique)
4. ต้องเท่ากันทั้งหมด ยกเว้น 3 ข้อในตารางข้อ 3

`docs/tools/catalog_diff.mjs` ทำข้อ 1–3 ให้แล้วด้วย PGlite 2 อินสแตนซ์ — **ไม่ต้องเขียน harness เพิ่ม**

## 5) หมายเหตุสำหรับเฟส 1

- Better Auth: 4 ตาราง (`user`, `session`, `account`, `verification`) ชื่อคอลัมน์ใน DB เป็น snake_case และ key ฝั่ง JS ต้องเป็นชื่อโมเดลของ Better Auth (`emailVerified`, `createdAt`) → `npx @better-auth/cli generate` จะได้ schema.ts ของเวอร์ชันจริง เอามาเทียบกับของเรา · **รอบล่าสุดยังไม่ได้รัน** (ดู `docs/reports/6.2-better-auth-diff-status.md`: ติดที่เครื่องมือ ยังไม่เริ่มรันคำสั่งใด ๆ) → ต้องรันก่อน migrate จริง
- `session.expires_at` ต้องเป็น `timestamp with time zone` — ถ้า generate ออกมาเป็น timestamp เปล่า ให้ยึดฝั่ง schema.sql (เทียบเวลาหมดอายุผิด timezone = ผู้ใช้ถูกเตะออกผิดเวลา)
- ห้าม `drizzle-kit push` ใส่ Neon branch ที่มีข้อมูลที่ต้องการเก็บ — ใช้ `generate` + review SQL + `migrate` เสมอ (`DATABASE_URL_DIRECT` เท่านั้น เพราะ pooled เป็น PgBouncer โหมด transaction รัน DDL ไม่ได้)
