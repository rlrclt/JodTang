# schema review — docs/schema.sql

รีวิวโดย: reviewer · 2026-09-13
ไฟล์ที่รีวิว: `/home/yoru/projects/jodjai/docs/schema.sql`
revision ที่รีวิว: 274 บรรทัด · 21,198 bytes · `md5 ed80289b165de33aa6559c4abd7276c9` · mtime 2026-09-13 03:08
**(รอบ 2)** v2 = 306 บรรทัด · 26,650 bytes · `md5 3473a198f705fc379c02348a7dc1adfc` → ผลตรวจอยู่ท้ายเอกสารหัวข้อ "รอบ 2"
ไฟล์นี้ **ไม่ถูกแก้** — ข้อเสนอทั้งหมดอยู่ในเอกสารนี้

## วิธีตรวจ (ไม่ใช่อ่านแล้วเดา)

เครื่องนี้ไม่มี `psql`/`docker` (ยืนยันตาม PLAN.md บรรทัด 61) จึงรัน Postgres จริงตัวจริงผ่าน WASM:
`@electric-sql/pglite` 0.5.8 = **PostgreSQL 18.3** (pg15+ ของโปรเจกต์ครอบคลุม) แล้ว
1) `exec` ไฟล์ DDL ทั้งไฟล์ 2) ยิง insert จริงเพื่อดูว่า constraint ไหนกันได้/กันไม่ได้
3) `EXPLAIN (ANALYZE)` ดูว่า index ถูกใช้จริงหรือไม่ 4) เทียบสำเนาที่ใส่ข้อเสนอแล้วว่ารันผ่านและปฏิเสธของเสีย

สคริปต์: `/tmp/pgtest/{check,diag,probe,probe2,probe3,probe4}.mjs` · รันซ้ำ: `cd /tmp/pgtest && node probe3.mjs`

**หมายเหตุสำคัญ — ไฟล์ถูกแก้ระหว่างรีวิว:** ตอนเริ่มรีวิว ไฟล์คือ 20,641 bytes ซึ่ง `categories` มีแต่
`unique (id, kind, user_id)` แต่ `budgets` (L241) อ้าง `categories (id, user_id)` → Postgres ปฏิเสธ:
`there is no unique constraint matching given keys for referenced table "categories"`
(พิสูจน์ด้วยตาราง 2 ตัวเล็ก ๆ รันแยก: FK อ้าง 2 คอลัมน์จาก unique 3 คอลัมน์ = REJECTED, อ้างชุดที่ตรง = ACCEPTED)
revision ปัจจุบัน (md5 ข้างบน) เพิ่ม `unique (id, user_id)` ที่ L150 แล้ว → **ปัญหานี้หมดไป**
ถ้าใครถือสำเนาเก่าอยู่ อย่าเอาไปรัน ต้องใช้ revision นี้

---

# สรุป

| ระดับ | จำนวน | เรื่อง |
|---|---|---|
| blocker | **0** | DDL รันผ่านครบทุก statement บน PG จริง ไม่มี error |
| major | 3 | currency ไม่ได้ล็อก THB จริง · การตัดเดือนไม่ถูกตรึงที่ DB · email ไม่ normalize ที่ DB |
| minor | 11 | FK กับ partial index · เพดาน initial_balance · budgets ผูกหมวด expense · คอมเมนต์ผิด 2 จุด · ชื่อว่าง · index หน้ากระเป๋า · archive/un-archive · double-submit · Better Auth diff กับ generate |

แก่นที่ต้องรู้: **โครงตารางถูกและแน่นกว่ามาตรฐาน general ledger ทั่วไป** — เงินเป็น bigint สตางค์ทุกที่,
composite FK กันข้ามผู้ใช้/kind ไม่ตรงหมวด, transfer เป็นแถวเดียวจึงนับซ้ำไม่ได้เชิงโครงสร้าง, shape check
กันโอนเข้าตัวเองจริงทุกกรณี. ที่เหลือคือ "ข้อที่ DB ยังไม่บังคับแต่บังคับได้ถูกกว่า" ไม่ใช่ "ทำผิด"

---

# 1) การเงิน — bigint สตางค์สม่ำเสมอ / ผลรวมไม่เพี้ยน

## ยืนยันแล้วว่าถูก (ไม่มีข้อแก้)

- grep ทั้งไฟล์ไม่พบ `numeric|decimal|float4|float8|double precision|real|money` แม้แต่ที่เดียว
  (เจอแต่คำในคอมเมนต์ L11) — เงินทั้ง 3 ที่เป็น bigint: `accounts.initial_balance` L118,
  `transactions.amount` L171, `budgets.amount` L236
- ผลรวมแม่นจริง: 100,000 แถว × 7 สตางค์ → `sum = 700000` (ไม่ใช่ `699999.9999`) และ
  `pg_typeof(sum(amount)) = numeric` → Postgres บวก bigint เป็น numeric เป๊ะ ไม่มี float เข้ามาเกี่ยวข้อง
- **ข้อควรรู้ฝั่งแอป (ไม่ใช่บั๊กของ DDL):** `numeric`/`bigint` ผ่าน driver ฝั่ง Node กลับมาเป็น **string**
  (`"700000"`) ไม่ใช่ number → ถ้าจะแปลงเป็น number ให้ทำหลังตรวจว่า < 9,007,199,254,740,991 เท่านั้น
  อย่า `parseFloat` มั่ว ๆ ไม่งั้นกลับมาเป็นบั๊กเงินที่ DDL พยายามกันไว้

## major 1.1 — "ล็อก THB" อยู่ในคอมเมนต์เท่านั้น ไม่มี check ที่ไหนเลย (L116, L172, L237 / กฎข้อ L19)

ทั้ง 3 ตารางเป็น `char(3) not null default 'THB'` แต่ไม่มีอะไรห้ามค่าอื่นเลย
**หลักฐาน (ยิงจริง):** `currency = 'USD'` → **ALLOWED** ทั้ง `transactions` และ `accounts`
และรายการสกุล USD ในกระเป๋า THB ก็ ALLOWED (ไม่มีอะไรผูก currency ของรายการเข้ากับของกระเป๋า)

**ทำไมเป็น major:** หน้าสรุป sum โดยไม่ได้ group by currency และ index `include (amount)` ก็ไม่มี currency อยู่ในนั้น
→ แถว USD แถวเดียวปนเข้าไปในยอด THB ถาวร โดยไม่มีสัญญาณเตือน = บั๊กเงินแบบที่หาสาเหตุยากที่สุด
สอดคล้องกับกฎข้อ 5 ของไฟล์เองที่บอกว่า "ล็อก 'THB'" — กฎที่ไม่มีใครบังคับคือกฎที่วันหนึ่งจะมีคนเผลอฝ่ามัน

**ข้อเสนอ:**

```sql
currency  char(3) not null default 'THB' check (currency = 'THB'),   -- L116, L172, L237
```
ตรวจแล้ว: แทรก 3 ที่ · apply ผ่าน · `'USD'` ถูกปฏิเสธทั้ง 2 ตาราง · รายการ/กระเป๋าปกติยังผ่าน (ผลจริงในภาคผนวก)
ถ้าอนาคตทำหลายสกุลจริง ต้องเพิ่ม composite FK `(account_id, user_id, currency)` + `group by currency` ทุก query
ไม่ใช่แค่ถอด check ออก

## minor 1.2 — `initial_balance` ไม่มีเพดานเหมือน `amount` (L118 vs L171/L236)

`amount` ถูกกันที่ `> 0 and < 1e15` แต่ `initial_balance` ปล่อยให้ใส่ได้ถึง 9.2e18 สตางค์ ซึ่งเกิน
`Number.MAX_SAFE_INTEGER` (9.007e15) → ยอดคงเหลือที่แอปคำนวณจะเพี้ยนแบบเงียบ (ค่าที่ใส่ได้แต่บวกแล้วไม่ตรง)
**ข้อเสนอ:** ใส่ check เพดานเดียวกับ `amount`

```sql
initial_balance  bigint not null default 0
  check (initial_balance > -1000000000000000 and initial_balance < 1000000000000000),
```
(ติดลบได้ตามที่คอมเมนต์ L117 ต้องการ แต่ไม่เกิน 1e15 เท่ากัน)

## minor 1.3 — คอมเมนต์เพดานเพี้ยน 1000 เท่า (L170)

คอมเมนต์: `เพดาน 1e15 สตางค์ (≈ 1 หมื่นล้านบาท)` — 1e15 สตางค์ = 1e13 บาท = **10 ล้านล้านบาท**
ตอนนี้ไม่มีผลต่อโค้ด แต่คนอ่านจะ "แก้" เพดานให้ตรงคอมเมนต์ แล้วพังของจริง

---

# 2) โอนเงินระหว่างกระเป๋า — ห้ามนับซ้ำเป็นทั้งรับและจ่าย

## ยืนยันแล้วว่าถูก

- **มี constraint กัน `account_id = to_account_id` จริง** — `transactions_shape_ck` L188–196
  ทดสอบแล้ว: โอนเข้าเลขเดียวกัน → `violates check constraint "transactions_shape_ck"` REJECTED
- โอนโดยไม่มีปลายทาง → REJECTED · โอนที่มี `category_id` → REJECTED · จ่ายที่มี `to_account_id` → REJECTED
  · จ่ายที่ไม่มีหมวด → REJECTED (ทั้ง 4 เคสเป็น `transactions_shape_ck` ทั้งหมด = กันด้วยที่เดียว)
- **นับซ้ำเป็นไปไม่ได้เชิงโครงสร้าง**: 1 transfer = 1 แถว (`kind='transfer'`) ไม่ใช่ 2 แถวคู่
  → ลบ/แก้ทีเดียวกระทบทั้งสองกระเป๋าพร้อมกัน ไม่มีโอกาสที่ฝั่งใดฝั่งหนึ่งค้าง
- โอนข้ามผู้ใช้ไม่ได้: `foreign key (to_account_id, user_id) references accounts (id, user_id)` L184
  (ยืนยัน: รายการที่ `user_id` ไม่ตรงกับเจ้าของกระเป๋า → FK violation)
- ข้อความเตือน `kind` ไม่ตรงหมวดก็บังคับแล้ว: จ่ายโดยใช้หมวด `income` → FK `(category_id, kind, user_id)` L186 ยิง REJECTED

## หมายเหตุ (ไม่ต้องแก้ DDL) — ที่ DB บังคับแทนไม่ได้

DB บังคับว่า "แถวต้องมีรูปถูก" แต่บังคับว่า "query ต้อง sum ถูก" ไม่ได้:
ถ้า query หน้าแรก/สรุปลืมกรอง `kind in ('income','expense')` แถว transfer จะถูกบวกเข้าด้วย (ยอดนี้จะเฟ้อ
ไม่ใช่ double-count แต่ก็ผิดอยู่ดี) และยอดคงเหลือต่อกระเป๋าต้องบวกฝั่ง `to_account_id` ด้วย
**ข้อเสนอ:** รวมทุกยอดเงินไว้ที่เดียว (`src/db/queries/money.ts` หรือ SQL view 1 ตัว) แล้วให้หน้าเว็บเรียกผ่านนั้น
เท่านั้น — ที่นี่สมควรใช้กฎ "1 ที่เดียว" มากกว่าการกระจายสูตรไปหลายไฟล์

---

# 3) occurred_at / การตัดเดือนตาม timezone ผู้ใช้

## ยืนยันแล้วว่าถูก

`occurred_at timestamptz not null default now()` L175 ✓ · `budgets.period_month date` L234 ✓
· `created_at/updated_at/expires_at/archived_at/deleted_at` เป็น timestamptz ทุกตัว
· `budgets_period_month_ck` L244 (`period_month = date_trunc('month', period_month)::date`) บังคับวันที่ 1 จริง
  — PG รับ expression นี้ใน check (immutable) และทดสอบแล้วว่าใส่ `2026-09-15` → REJECTED

## major 3.1 — การตัดเดือนไม่ได้ถูกตรึงไว้ที่ไหนเลย และมันเพี้ยนเงียบ ๆ อยู่ 7 ชั่วโมง

v1 ล็อก Asia/Bangkok (L21, L273) แต่ไม่มีคอลัมน์ timezone ผู้ใช้ และไม่มีอะไรบังคับว่าขอบเขตเดือนต้องคิดที่ +07
**หลักฐานจริง (สร้างข้อมูล 2 แถวขอบเดือนแล้ว sum):**

```
ยอดจ่ายเดือน 2026-09 ของผู้ใช้ u1
  ตัดเดือนด้วยขอบเขต +07 (ไทย) : expense = 161111 สตางค์
  ตัดเดือนด้วยขอบเขต UTC 00:00 : expense = 172222 สตางค์
  ต่างกัน 11111 สตางค์ จากรายการเดียวที่เกิด 2026-09-01 00:30+07 (= 2026-08-31 17:30 UTC)
```
รายการตอน 00:00–07:00 ของวันที่ 1 ย้ายเดือนเงียบ ๆ และ `budgets.period_month` ก็ต้องใช้ขอบเขตเดียวกัน
ไม่งั้นเทียบ "ใช้งบไปเท่าไร" ผิดเดือน

**ข้อเสนอ (เลือกข้อเดียว)**
- (ก) ถูกสุด ไม่ต้องแก้ DDL: helper เดียว `bkkMonthRange(periodMonth)` ในชั้น query + เทสต์เคส 00:30+07 และ 03:00+07
  (2 เคสนี้คือ 2 เคสที่จะพังถ้าเปลี่ยนไปใช้ UTC)
- (ข) ตรึงที่ DB ให้คำนวณขอบเขตที่ไหนอีกไม่ได้เลย (ตรวจแล้วว่า PG รับและให้ผลตรงกับ +07 เป๊ะ):

```sql
alter table transactions add column occurred_month_bkk date
  generated always as ((date_trunc('month', occurred_at at time zone interval '7 hours'))::date) stored;
create index transactions_user_month_idx on transactions (user_id, occurred_month_bkk) where deleted_at is null;
```
หลังใส่แล้ว query หน้าสรุป/งบใช้งวดเดือนแบบ equality (`occurred_month_bkk = date '2026-09-01'`) →
EXPLAIN ได้ `Index Scan using transactions_user_month_idx` และ group by ได้งวดที่ถูกต้อง
(ส.ค. / ก.ย. / ต.ค. ตรงตามเวลาไทย) โดยไม่มีเลข magic ในโค้ดแอป
ใช้ `interval '7 hours'` ได้เพราะไทยไม่มี DST → `timezone(interval, timestamptz)` เป็น immutable
(PG รับเป็น generated column จริง — ลองแล้วทั้งสองแบบ ไม่ใช่ค่าที่คำนวณสด ๆ)

---

# 4) index ของหน้าแรก/หน้าสรุป + unique/check ที่ยังขาด

## ยืนยันแล้วว่าถูก — ทุก query หลักมี index รองรับจริง (ไม่ใช่ seq scan)

รันด้วยข้อมูลจริง 5,302 แถว (ผู้ใช้รายใหญ่ 5,000 / ผู้ใช้ที่ดู 302) + `vacuum analyze`:

| query | plan ที่ได้จริง |
|---|---|
| หน้าแรก รายการล่าสุด 20 | `Index Scan using transactions_user_recent_idx` (0.08 ms) |
| รายการทั้งหมด keyset `(occurred_at,id) < (...)` | `Index Only Scan using transactions_user_recent_idx` |
| ยอดเดือนนี้แยก kind | `Index Only Scan using transactions_user_kind_time_idx` · **Heap Fetches: 0** (include(amount) ทำงานจริง) |
| แนวโน้ม 6 เดือน | `Index Only Scan using transactions_user_kind_time_idx` · Heap Fetches: 0 |
| สัดส่วนตามหมวด | Bitmap scan บน `transactions_user_kind_time_idx` (planner เลือกตัวที่ถูกกว่าบนข้อมูลชุดนี้ — `transactions_user_category_time_idx` ก็ใช้ได้) |
| ยอดคงเหลือต่อกระเป๋า | `Index Scan using transactions_account_idx` |

ข้อควรรู้: index-only scan ได้ต่อเมื่อ visibility map อัปเดต (autovacuum ปกติ) — คอมเมนต์ L207 จึงจริงแบบมีเงื่อนไข

## minor 4.1 — index ที่ FK ใช้ตรวจสอบเป็น partial → FK ใช้ไม่ได้ (L219–222, L224–226)

คอมเมนต์ L219 บอก `transactions_account_idx` "รองรับ FK ตอนลบ/ย้ายกระเป๋า" — **ไม่จริง**
PG ตรวจ FK ด้วย query ที่ไม่มีเงื่อนไข `deleted_at`:
`SELECT 1 FROM ONLY transactions x WHERE account_id = $1 AND user_id = $2 FOR KEY SHARE OF x`
(src/backend/utils/adt/ri_triggers.c) → partial index `where deleted_at is null` ถูกข้ามเพราะ query ไม่ได้ imply predicate

**หลักฐาน:** `EXPLAIN` RI-style query บนตาราง 100k แถว
- ปัจจุบัน: `Seq Scan` (และเมื่อ `set enable_seqscan = off` ก็ยังเป็น `Seq Scan ... Disabled: true`
  = ไม่มี index ตัวไหนใช้ได้จริง ไม่ใช่แค่ planner เห็นว่าแพง)
- หลังเพิ่ม `create index ... on transactions (account_id, user_id)` แบบไม่ partial: RI query เปลี่ยนเป็น `Bitmap Index Scan`
- ส่วน query ของแอปที่กรอง `deleted_at is null` ยังใช้ partial index ได้เป็น `Index Only Scan` ปกติ

**ผลกระทบ:** การลบ user (cascade), ลบกระเป๋าแบบ hard หรืออัปเดตคีย์อ้างอิง ต้องสแกนทั้งตารางต่อ 1 แถว
v1 ใช้ `archived_at` จึงไม่ค่อยเจอ แต่จะเจอตอนลบบัญชีผู้ใช้ / ตอน import
**ข้อเสนอ:** ถอด `where deleted_at is null` ออกจาก `transactions_account_idx` และ
`where to_account_id is not null` ออกจาก `transactions_to_account_idx` (query แอปยังใช้ได้เหมือนเดิม
เพราะ non-partial เป็น superset) หรือคงไว้แล้วแก้คอมเมนต์ให้เลิกอ้างว่ารองรับ FK

## minor 4.2 — `budgets` ผูกหมวด `kind='expense'` ไม่ได้ที่ DB (L241, L247–248)

คอมเมนต์ยอมรับว่า check ข้ามตารางไม่ได้ และให้แอปกรอง — แต่บังคับที่ DB ได้ด้วย 1 คอลัมน์ (ตรวจแล้วว่าใช้ได้จริง):

```sql
-- ในตาราง budgets
category_kind text not null default 'expense' check (category_kind = 'expense'),
foreign key (category_id, category_kind, user_id) references categories (id, kind, user_id),
```
ผลทดสอบสำเนาที่แก้: budget บนหมวด `income` → FK violation REJECTED · budget บนหมวด `expense` → ผ่าน
**โบนัส:** หลังเปลี่ยน FK นี้ ไม่มี FK ตัวไหนอ้าง `categories (id, user_id)` อีก → ลบ `unique (id, user_id)` L150 ออกได้
(ยืนยันจาก catalog: FK ที่อ้าง categories เหลือแต่ชุด `(id, kind, user_id)`) = index ลด 1 ตัว ชดเชยคอลัมน์ที่เพิ่ม แล้วปิดช่องที่ต้องพึ่งวินัยแอป

## minor 4.3 — ไม่มี check กันชื่อว่าง (L113, L140)

`name = ''` หรือ `name = '   '` ใส่ได้ และจะชนกันเองผ่าน partial unique index (`lower(btrim(name))`) →
มีชื่อว่างได้คนละ 1 ตัว แล้วครั้งที่สองได้ error `duplicate key value violates unique constraint` ซึ่งอ่านไม่รู้เรื่อง
**ข้อเสนอ:** `check (btrim(name) <> '')` ทั้ง `accounts` และ `categories` (ตารางละ 1 บรรทัด)

## minor 4.4 — index หน้ากระเป๋าเงิน (L220–222) — ยังไม่ต้องทำ

ยอดต่อกระเป๋าต้องอ่าน `kind` + `amount` ซึ่งไม่ได้อยู่ใน index ปัจจุบัน:
`Index Scan` 302 แถว = 2.4 ms · หลังเพิ่ม `(user_id, account_id) include (amount, kind) where deleted_at is null`
→ `Index Only Scan` Heap Fetches: 0 = 0.7 ms (ข้อมูลทดสอบเล็ก ๆ ต่างกันน้อย)
ไฟล์นี้ตั้งกติกาไว้เองว่า "อย่าเพิ่มก่อนมี query" (L199) → **ยังไม่ต้องเพิ่ม** วัดตอนข้อมูลจริงก่อน
ถ้าอยากได้ index ที่รองรับทั้งหน้าแรกและหน้ากระเป๋า ให้ใช้ตัวนี้แทน `(user_id, occurred_at desc, id desc)` ไม่ใช่เพิ่มซ้อน

## minor 4.5 — คอมเมนต์ L153 บอกว่า FK ต้องการ unique ที่ "ตรงชุดและตรงลำดับ"

ลำดับไม่เกี่ยว. PG ตรวจว่า index ที่ unique ต้องมี **จำนวนคีย์เท่ากันและครอบคลุมชุดคอลัมน์เดียวกัน** เท่านั้น
(source `tablecmds.c` → `transformFkeyCheckAttrs`: `indnkeyatts == numattrs` แล้วจับคู่
`attnums[i]` กับคีย์ของ index "in any order")
**ข้อเสนอ:** ตัดคำว่า "และตรงลำดับ" ออก ไม่งั้นมีคนเพิ่ม unique index ซ้ำอีกตัวโดยไม่จำเป็น

## ที่ตรวจแล้วว่า unique/check ทำงานถูก (ไม่ต้องแก้)

- `amount > 0 and < 1e15`: 0 → REJECTED · -100 → REJECTED · 1e15 → REJECTED · 1e15-1 → ผ่าน ✓
- `budgets unique (user_id, category_id, period_month)`: ใส่ซ้ำ → `duplicate key ... period_month_key` ✓
- ชื่อกระเป๋าซ้ำต่างตัวพิมพ์/ช่องว่าง (`เงินสด` vs `  เงินสด`) → REJECTED ✓ (L130–133 ทำงานตามคอมเมนต์)
- ชื่อเดิมหลัง archive → ผ่าน ✓ (ตามที่คอมเมนต์ตั้งใจ)

---

# 5) soft delete — unique constraint กับ query ยังถูกต้องไหม

## ยืนยันแล้วว่าถูก

- partial unique index `where archived_at is null` ทำงานตามที่ออกแบบ: ชื่อซ้ำตอน active → REJECTED,
  archive แล้วสร้างชื่อเดิม → ALLOWED, un-archive กลับมาแล้วชื่อชนกับตัวที่ active → REJECTED
  ด้วย `duplicate key value violates unique constraint "accounts_user_name_uidx"` (ทดสอบแล้ว — ดู 5.2)
- soft delete ของ transactions: เพิ่มรายการค่าเดิมหลังลบรายการเก่า → ALLOWED (ไม่มี unique มาชน แต่ก็ไม่มีอะไรกัน double-submit
  ด้วย — ดู 5.3)
- archive กระเป๋าที่มีรายการอ้างอยู่ → ALLOWED ✓ และรายการเก่ายังนับยอดได้ตามปกติ (เพราะไม่ได้ลบจริง)
- การลบรายการเป็น soft → partial index ของ FK ไม่พัง (แถวยังอยู่) ✓

## minor 5.1 — เพิ่มรายการเข้ากระเป๋าที่ archive แล้วได้ (L122 vs L183)

ทดสอบ: `update accounts set archived_at = now()` แล้ว insert รายการใหม่เข้ากระเป๋านั้น → ALLOWED
ฟอร์มกรองอยู่ก็จริง แต่ API ตรงจะยอมรับ = กระเป๋าที่ "ซ่อนแล้ว" ยังมียอดขยับได้
**ข้อเสนอ:** เป็นเรื่องชั้นแอป (validate ก่อน insert) ไม่ต้องทำ trigger ใน v1 — แต่ควรมีเทสต์เคสนี้

## minor 5.2 — un-archive ต้องดัก error (ทดสอบแล้วว่าล้มจริง)

สถานการณ์จริง: ผู้ใช้ archive "เงินสด" → สร้าง "เงินสด" ใหม่ → กดกู้คืนอันเก่า:
`REJECTED -> duplicate key value violates unique constraint "accounts_user_name_uidx"`
ปุ่มกู้คืนต้องจับ error นี้แล้วบอกผู้ใช้ให้เปลี่ยนชื่อ ไม่งั้นหน้าเว็บจะ 500 เปล่า ๆ

## minor 5.3 — ไม่มีอะไรกันการส่งซ้ำ (แตะเบิ้ล/เน็ตช้า retry)

ตารางไม่มี unique ที่เกี่ยวกับ idempotency และทดสอบแล้วว่าใส่แถวเดิมซ้ำได้
**ข้อเสนอ (ถูกสุด):** ให้ client ส่ง `id` (uuid) เอง แล้วใช้ PK เป็น idempotency key
— อย่าให้ `gen_random_uuid()` ฝั่ง server สร้างทุกครั้ง เพราะจะได้ 2 แถว (ระบุใน API contract ตอนเฟส 2)

---

# 6) ตาราง Better Auth + email เป็น null

## ยืนยันแล้วว่าถูก — เทียบกับ core schema ของ Better Auth แล้วครบ 4 ตาราง

ดึงคอลัมน์จริงจาก `information_schema` หลัง apply ไฟล์นี้:

```
user         id, name, email(NULL), email_verified, image, created_at, updated_at
session      id, expires_at, token, ip_address, user_agent, user_id, created_at, updated_at
account      id, account_id, provider_id, user_id, access_token, refresh_token, id_token,
             access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at
verification id, identifier, value, expires_at, created_at, updated_at
```
ตรงกับ core schema ในเอกสาร Better Auth (user/session/account/verification) และรายชื่อฟิลด์ใน source
`packages/core/src/db/get-tables.ts` (identifier/value/expiresAt, ipAddress/userAgent, emailVerified,
accountId/providerId/accessToken/…) — ไม่มีคอลัมน์แปลกปลอมที่ไม่อยู่ในสัญญาของ Better Auth ✓
· `account.password` เก็บไว้แต่ nullable ตามที่ BA ต้องการ ✓
· unique ที่ BA พึ่ง: `session.token` (L57) ✓ · `account (provider_id, account_id)` (L87) ✓ · index `session(user_id)` L66 · `account(user_id)` L90 · `verification(identifier)` L102 ✓

**email เป็น null ได้จริง:** `email text` L42 (ไม่มี not null) + `unique (email)` L50
→ ทดสอบใส่ 2 ผู้ใช้ที่ `email = null` พร้อมกัน = ALLOWED (PG15+ นับ NULL เป็นค่าไม่ซ้ำโดย default)
ตรงกับข้อกำหนด LINE ที่อาจไม่ให้อีเมล และ `email_verified default false` L44 ก็ตรงกับที่ LINE ไม่ยืนยันอีเมล ✓

## major 6.1 — email ถูก normalize ที่ DB ไม่เหมือนชื่อกระเป๋า/หมวด

`accounts`/`categories` บังคับ `lower(btrim(name))` ที่ DB แต่ email พึ่งวินัยแอป (คอมเมนต์ L49)
**หลักฐาน:** insert `YORU@X.COM` ขณะมี `yoru@x.com` อยู่ → ALLOWED (ได้ 2 user อีเมลเดียวกัน)
วันที่มี email/password หรือ recovery (`'reset-password:<email>'` L94) = ลิงก์รีเซ็ตไปหาบัญชีผิดคนแบบเงียบ ๆ
**ข้อเสนอ (1 บรรทัด, ไม่ต้องแตะ unique/L49):**

```sql
email text check (email is null or email = lower(btrim(email))),
```
ทดสอบสำเนาที่แก้: `YORU@X.COM` → REJECTED · user ที่ `email = null` ยังสมัครได้ · login ปกติไม่กระทบ
(คง `unique (email)` ไว้ → lookup `email = $1` ของ Better Auth ยังใช้ index เดิม)
เหตุผลที่เลือก "ล้มเสียงดัง": provider ส่งตัวพิมพ์ใหญ่ = insert ล้มทันที ดีกว่าได้ user ซ้ำที่ไม่มีใครรู้

## minor 6.2 — ยังไม่เคย diff กับ `npx @better-auth/cli generate` (L32–35)

ไฟล์เขียนไว้เองแล้ว (ถูกต้อง) ว่าต้อง generate แล้ว diff — ตอนนี้ยังไม่มีโค้ด จึงยัง diff ไม่ได้
เฟส 1 ต้องรันก่อน migrate จริง · ถ้า generate ออกมาเป็น `timestamp` (ไม่มี tz) ให้คง DDL ฝั่งนี้ไว้
โดยเฉพาะ `session.expires_at` — เปรียบเทียบเวลาหมดอายุผิด timezone = ผู้ใช้ถูกเตะออกผิดเวลา

---

# ภาคผนวก — คำสั่งที่ใช้ตรวจ และผลจริง

```bash
# 1) ยืนยันรูปแบบที่ PG บังคับกับ composite FK (ดึง source PG มาเช็ค ไม่ได้เดา)
curl -sL https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/commands/tablecmds.c
#   transformFkeyCheckAttrs: ต้องมี unique index ที่ indnkeyatts == จำนวนคอลัมน์ที่อ้าง
#   "The given attnum list may match the index columns in any order" → ลำดับไม่เกี่ยว ชุด+จำนวนเกี่ยว
# ที่มา: คอมเมนต์ L153 เขียนว่า "ตรงชุดและตรงลำดับ" → คำว่า "ลำดับ" ไม่จริง (minor 4.5 ข้างบน)

# 2) ตรวจ FK ใช้ index อะไร
curl -sL https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/utils/adt/ri_triggers.c
#   RI_KEYS_NONE_NULL → "SELECT 1 FROM ONLY <tbl> x WHERE <fkcols> FOR KEY SHARE OF x" (ไม่มี deleted_at)

# 3) รัน Postgres จริง (WASM) — apply DDL + ยิง insert + EXPLAIN
cd /tmp/pgtest && npm i @electric-sql/pglite && node probe3.mjs
```

ผลสำเนาที่ใส่ข้อเสนอแล้ว (ตรวจว่าข้อเสนอไม่ทำให้ของเดิมพัง):

```
2.0 diff                  บรรทัด 275 -> 276 (+1) · check(currency) ถูกแทรก 3 ที่
2.1 apply สำเนาที่แก้     APPLIED OK
2.2 transactions USD      REJECTED -> violates check constraint "transactions_currency_check"
2.3 accounts USD          REJECTED -> violates check constraint "accounts_currency_check"
2.4 email ต่างตัวพิมพ์    REJECTED -> violates check constraint "user_email_check"
2.5 user email = null     ALLOWED
2.6 budget หมวด income    REJECTED -> violates foreign key constraint "budgets_category_id_category_kind_user_id_fkey"
2.7 budget หมวด expense   ALLOWED
2.8 รายการปกติ            ALLOWED
```

ลำดับที่แนะนำให้แก้ (เรียงตามความคุ้มค่า — ใช้เลขข้อในเอกสารนี้):
**major 1.1 currency check (3 บรรทัด) → major 6.1 email check (1 บรรทัด) → major 3.1 ตัดเดือน (เลือก ก หรือ ข)
→ minor 1.2 เพดาน initial_balance → minor 4.2 budgets expense-only → minor 1.3 + 4.5 คอมเมนต์
→ minor 4.1 index FK → ที่เหลือรอวัดตอนมีข้อมูลจริง**

## ที่ยังไม่ได้ตรวจ (บอกตรง ๆ)

- ยังไม่เคยรันบน Neon จริง (ไม่มี credential และไม่ควรยิง DDL ใส่ DB จริงโดยไม่ได้รับอนุญาต)
  — ที่รันคือ PG 18.3 ใน WASM ซึ่งใช้กฎเดียวกับ PG15+ ในเรื่อง composite FK / partial index / check immutability
- ยังไม่ได้ diff กับ drizzle schema เพราะยังไม่มีโค้ด (minor 6.2)
- แผน index อ่านจากข้อมูลทดสอบ 5.3k แถว ไม่ใช่ข้อมูล production → ตัวเลขเวลาเป็นแนวโน้ม ไม่ใช่ข้อสรุป

---

# รอบ 2 — ตรวจ v2 (diff v1 → v2)

revision ที่ตรวจ: **306 บรรทัด · 26,650 bytes · `md5 3473a198f705fc379c02348a7dc1adfc`** · mtime 2026-09-13 03:23
(v1 = 274 บรรทัด · 21,198 bytes · `md5 ed80289b165de33aa6559c4abd7276c9` — หัวข้อ 1–6 ข้างบนคือรีวิว v1)

## วิธีตรวจรอบนี้ (และข้อจำกัดที่ต้องบอกตรง ๆ)

1. apply v2 ทั้งไฟล์บน PG 18.3 (PGlite) → **APPLIED OK ไม่มี error** (`probe5.mjs`)
2. ยิง insert จริง 22 เคส: 13 เคสคือ check ที่เพิ่มมาใหม่ + 9 เคสคือ regression ของเดิม
3. dump catalog (`catalog.mjs`) เทียบ v1: คอลัมน์ / constraint / index ของ **ทุกตาราง** รวมของ Better Auth
4. `EXPLAIN (ANALYZE, BUFFERS)` 7 query หลัก (`probe5.mjs`, `probe6.mjs`)

**ข้อจำกัดของ "diff v1→v2":** เครื่องนี้ไม่มีสำเนา v1 เป็นไฟล์ (repo ยังไม่มี commit เลย —
`git status` = `?? docs/`) จึงทำ byte-diff ไม่ได้ ทำได้แค่ (ก) เทียบ catalog ระดับเครื่อง
(ข) อ่านทั้ง 2 revision เทียบทีละส่วน ที่เหลืออยู่ใน transcript รีวิวนี้
→ **ข้อเสนอ:** `git add docs/ && git commit` ก่อนแก้รอบหน้า จะได้ `diff` จริงในรอบต่อไป (และได้ประวัติว่าใครแก้อะไร)

## ผลตรวจ 7 ข้อที่สั่งแก้ — ผ่านทั้ง 7

| # | ที่แก้ | หลักฐานที่รันจริง | ผล |
|---|---|---|---|
| 1 | `occurred_month_bkk` (generated) + index | แถวขอบเดือน `2026-08-31 23:30+07`→**Aug** · `2026-09-01 00:30+07`→**Sep** · `2026-10-01 03:00+07`→**Oct** ✓ · ยอดเดือนด้วย equality บนคอลัมน์ใหม่ = ยอดด้วยช่วง `+07` เป๊ะ (`expense 11111 · income 100000`) ✓ · insert ค่าใส่คอลัมน์ตรง ๆ → `cannot insert a non-DEFAULT value` ✓ | ผ่าน |
| 2 | currency = THB 3 ตาราง | `USD` → REJECTED ทั้ง `transactions`/`accounts`/`budgets` (`*_currency_check`) · `THB` ปกติผ่าน ✓ | ผ่าน |
| 3 | `user.email` lower(btrim()) | `A@B.COM` → REJECTED · `' a@b.com '` → REJECTED · `email = null` → ALLOWED · 2 user ที่ email null อยู่ร่วมกันได้ ✓ · lookup `email = $1` ยังใช้ unique index เดิม ✓ | ผ่าน |
| 4 | ถอด partial predicate 2 index | FK check query (`SELECT 1 FROM ONLY transactions x WHERE account_id=$1 AND user_id=$2 FOR KEY SHARE`) เปลี่ยนจาก **Seq Scan (even enable_seqscan=off)** → **Index Scan using transactions_account_idx** ด้วยค่า default · ฝั่ง `to_account_id` ก็ได้ `Index Scan using transactions_to_account_idx` ✓ | ผ่าน |
| 5 | `btrim(name) <> ''` | `''` → REJECTED · `'   '` → REJECTED ทั้ง `accounts`/`categories` · ชื่อปกติผ่าน ✓ | ผ่าน |
| 6 | เพดาน `initial_balance` ±1e15 | `+1e15` → REJECTED · `-1e15` → REJECTED · `+1e15-1` และ `-1e15+1` → ALLOWED ✓ (ติดลบที่จำเป็นสำหรับบัตรเครดิตยังใช้ได้) | ผ่าน |
| 7 | คอมเมนต์ 1e15 = 10 ล้านล้านบาท | L176 ตรงกับความจริงแล้ว ✓ | ผ่าน |

## regression — ของเดิมไม่พัง (ยิงซ้ำทั้งชุด)

| เคส | ผล |
|---|---|
| transfer `account_id = to_account_id` | REJECTED (`transactions_shape_ck`) ✓ |
| transfer ไม่มี `to_account_id` | REJECTED ✓ |
| transfer มี `category_id` | REJECTED ✓ |
| expense มี `to_account_id` | REJECTED ✓ |
| รายการอ้างกระเป๋าผู้ใช้อื่น (u2 → กระเป๋า u1) | REJECTED (composite FK) ✓ |
| expense ใช้หมวด `income` | REJECTED (composite FK) ✓ |
| `amount = 0` / `amount = 1e15` | REJECTED ✓ |
| ชื่อกระเป๋าซ้ำต่างตัวพิมพ์/ช่องว่าง | REJECTED (`accounts_user_name_uidx`) ✓ |
| `email` null หลายคน (LINE) | ALLOWED ✓ |
| หน้าแรก / keyset / ยอดต่อกระเป๋า / สรุป 6 เดือน | index ถูกใช้ครบ ไม่มี seq scan บนตารางโต ✓ |

## "ไม่มีอะไรเกินคำสั่ง" — ผลต่าง catalog v1 → v2

- **คอลัมน์:** `transactions` 13 → 14 (เพิ่ม `occurred_month_bkk` เท่านั้น) · ที่เหลือเท่าเดิม
  (`accounts` 11 · `categories` 10 · `budgets` 8 · `user` 7 · `session` 8 · `account` 13 · `verification` 6)
  → บวกอย่างเดียว ไม่มีคอลัมน์ถูกถอด/เปลี่ยนชื่อ
- **constraint:** เพิ่มเฉพาะ check 7 ตัว (currency 3 · email 1 · name 2 · initial_balance 1)
  → FK / unique / PK ชุดเดิมครบทั้งหมด ไม่มีตัวใดถูกถอดออก
- **index:** เพิ่ม 1 ตัว (`transactions_user_month_idx`) · `transactions_account_idx` /
  `transactions_to_account_idx` เปลี่ยนแค่ predicate (ถอด partial) · ตัวอื่นเหมือนเดิม
- **ตาราง Better Auth ทั้ง 4:** ไม่ถูกแตะเลย (คอลัมน์เท่าเดิมทั้งชื่อและลำดับ)
- **ข้ามตามคำสั่ง ✓:** `budgets` ยังอ้าง `categories (id, user_id)` และไม่มี `category_kind`
  (= 4.2 ยังไม่ทำ) · ไม่มี `include` ถูกเพิ่มให้ index หน้ากระเป๋า (= 4.4 ยังไม่ทำ) — ตรงตามที่ตกลง
- **หมายเหตุ:** ระดับ byte ของบรรทัดคอมเมนต์ตรวจได้แค่ว่า "อ่านทั้ง 2 revision แล้วพบเฉพาะคอมเมนต์ที่ตั้งใจแก้"
  (ข้อจำกัดตามหัวข้อ "วิธีตรวจรอบนี้")

## ข้อใหม่ที่เจอในรอบ 2

### minor 7.1 — `transactions_user_month_idx` ไม่มี `include` → query งวดเดือน "ไม่" index-only (วัดแล้ว)

v2 เปลี่ยนสไตล์ query ของหน้าสรุปมาใช้ `occurred_month_bkk = ...` ซึ่งเป็นคอลัมน์ที่ **ไม่มี** ใน
`transactions_user_kind_time_idx` (และ `amount` ก็ไม่ได้อยู่ใน `month_idx`) → ทั้งสองทางต้องแตะ heap
ต่างจากคอมเมนต์ L223–224 ที่บอกว่าจะได้ index-only scan

วัดจริง (ผู้ใช้ทดสอบ 302 แถว, ผู้ใช้รายใหญ่ 30,000 แถว, `vacuum analyze` แล้ว):

| query | index ชุด v2 | buffers | เวลา | ถ้า `month_idx` + `include (amount, kind)` | buffers | เวลา |
|---|---|---|---|---|---|---|
| ยอดเดือนนี้แยก kind | `Index Scan transactions_user_kind_time_idx` | 9 | 1.50 ms | `Index Only Scan` · Heap Fetches 0 | 1 | 0.58 ms |
| แนวโน้ม 6 เดือน (group by งวด) | `Index Scan transactions_user_month_idx` | 8 | 0.66 ms | `Index Only Scan` · Heap Fetches 0 | 4 | 0.33 ms |

**ข้อเสนอ:** `create index transactions_user_month_idx on transactions (user_id, occurred_month_bkk) include (amount, kind) where deleted_at is null;`
· โบนัสที่วัดได้: พอ `month_idx` มี include แล้ว planner เลือกตัวนี้ทั้งสองหน้า **แม้ `kind_time_idx` ยังอยู่**
→ `transactions_user_kind_time_idx` กลายเป็นตัวซ้ำซ้อน ควรวัดหน้าจริงก่อนตัด (ถ้าไม่มีหน้าไหนต้องกรองช่วงวันที่
ที่ไม่ตรงกับงวดเดือนเลย ก็ตัดออกได้ = index บน transactions ลดจาก 6 เหลือ 5)
· ไม่ใช่บั๊กและไม่ใช่ correctness — เป็นเรื่อง index-only scan ที่ไฟล์ตั้งความคาดหวังไว้เอง

### minor 7.2 — changelog ในไฟล์อ้างเลขข้อไม่ตรงกับเอกสารนี้ 3 จุด

เอกสารนี้ถูก renumber ระหว่างที่ v2 เขียน (เพิ่ม `major 1.1` เรื่อง currency แล้วเลื่อน minor 1.x) → L290–298 ของ v2:
`major 2.x` (currency) ที่ถูกคือ **major 1.1** · `minor 1.1` (initial_balance) ที่ถูกคือ **minor 1.2**
· `minor 1.2` (คอมเมนต์ 1e15) ที่ถูกคือ **minor 1.3** · ส่วนเรื่องคอมเมนต์ "ตรงลำดับ" ที่ถูกคือ **minor 4.5**
(ไม่ใช่ 4.3) — ที่ตรงแล้วคือ `major 6.1`, `minor 4.1`, `minor 4.3`
แก้แค่คอมเมนต์ ไม่กระทบ DDL แต่ถ้าปล่อยไว้จะตามรอยกันไม่ได้ในรอบถัดไป

### note 7.3 — สัญญาฝั่ง drizzle ต้องรู้เรื่องคอลัมน์ generated

- ประกาศเป็น `generatedAlwaysAs` และ **ห้าม** ส่งค่าใน insert/update (PG ปฏิเสธ: `cannot insert a non-DEFAULT value into column "occurred_month_bkk"` — ยืนยันแล้ว)
- `select *` จะมีคอลัมน์นี้เพิ่ม · script seed/import ที่ระบุ `insert into transactions values (...)` แบบไม่ระบุชื่อคอลัมน์จะพัง → ต้องระบุชื่อคอลัมน์เสมอ
- เป็น `date` (ไม่มี tz) ตามที่ออกแบบ: เก็บ "วันแรกของเดือนไทย" เพื่อเทียบ `budgets.period_month` แบบ equality

## สถานะหลัง v2

- **ผ่าน:** 7/7 ข้อที่สั่งแก้ + regression ครบ · "ไม่มีอะไรเกินคำสั่ง" ✓ · md5 ตรงตามที่แจ้ง ✓
- **ค้างตามที่ตกลง (ไม่นับเป็น fail):** minor 4.2 (budgets ผูกหมวด expense-only) · minor 4.4 (index หน้ากระเป๋า — รอวัด)
  · minor 5.1/5.2/5.3 (ชั้นแอป: validate กระเป๋า archive, ดัก 23505 ตอนกู้คืน, client ส่ง uuid กันส่งซ้ำ) · minor 6.2 (`npx @better-auth/cli generate` ตอนเฟส 1)
- **ใหม่จากรอบ 2:** minor 7.1 (include ให้ month index) · minor 7.2 (เลขข้อใน changelog) · note 7.3 (drizzle/generated column)
- คำสั่งรันซ้ำ: `cd /tmp/pgtest && node probe5.mjs` (ผลตรวจ 7 ข้อ + regression) · `node probe6.mjs` (ตัวเลข index-only) · `node catalog.mjs` (โครง schema)
