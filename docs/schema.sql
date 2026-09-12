-- ============================================================================
-- จดจ่าย (JodJai) — Postgres DDL v2 (ปิด major 3 ข้อ + minor ที่ตกลงจาก docs/schema-review.md)
-- เป้าหมาย: Neon Postgres (PG15+) · แหล่งความจริงเดียวของโครงข้อมูล
-- รันด้วย connection แบบ direct (DATABASE_URL_DIRECT) เท่านั้น
--   เหตุผล: DATABASE_URL เป็น PgBouncer โหมด transaction → รัน DDL/migration ไม่ได้
--   ตัวอย่าง: psql "$DATABASE_URL_DIRECT" -f docs/schema.sql
-- ไฟล์นี้คือ "สัญญา" ที่ drizzle schema ต้องตรงกับมัน ถ้าแก้ตารางต้องแก้ทั้งคู่ใน commit เดียว
-- ============================================================================

-- กติกาที่ล็อกตายทั้งโปรเจกต์ (อ่านก่อนแก้)
--   1. เงิน = bigint หน่วย "สตางค์" เสมอ (1 บาท = 100) ห้าม numeric/float/real
--      ถ้าเก็บเป็นบาทแล้วคูณ 100 ที่ชั้นแอป จะเจอ 0.1+0.2 ไม่ตรงยอด — บั๊กเงินคือบั๊กที่แพงที่สุด
--   2. จำนวนเงิน "เป็นบวกเสมอ" ทิศทาง (รับ/จ่าย) มาจาก kind ไม่ใช่เครื่องหมาย
--      ยอดคงเหลือ = initial_balance + income - expense (+ ผลของ transfer ที่หัก/เพิ่มฝั่งบัญชี)
--   3. ทุกตารางของผู้ใช้มี user_id และทุก query ต้องมี user_id = <session user> เสมอ
--      (ไม่กรอง = รั่วข้อมูลข้ามบัญชี) กันไว้ที่ชั้น DB ด้วย composite FK ด้านล่างด้วย
--   4. ลบรายการ = soft delete (transactions.deleted_at) · ทุก query ต้องมี deleted_at is null
--      กระเป๋า/หมวดที่เลิกใช้ = archived_at (ไม่ลบ เพราะรายการเก่าอ้างอยู่)
--   5. currency เก็บไว้แต่ v1 ไม่แปลงข้ามสกุล — ล็อก 'THB' ด้วย check constraint ทั้ง 3 ตาราง (ไม่ใช่แค่ default)
--   6. วันที่/เวลาเป็น timestamptz เสมอ · งวดเดือนของงบเป็น date (วันแรกของเดือน)
--      การตัดเดือน/ปีของหน้าแรก–หน้าสรุปต้องใช้ timezone ผู้ใช้ (Asia/Bangkok) ไม่ใช่ UTC
--   7. "user" เป็นคำสงวนของ SQL → ต้องใส่ double quote ทุกที่ที่อ้างถึง

-- ---------------------------------------------------------------------------
-- ตารางของ Better Auth (user, session, account, verification)
-- ---------------------------------------------------------------------------
-- ชื่อคอลัมน์ในฐานข้อมูลเป็น snake_case; ใน drizzle ให้ตั้ง key เป็น camelCase
-- ตามชื่อโมเดลของ Better Auth แล้วผูกชื่อคอลัมน์จริงในพารามิเตอร์ 2:
--     emailVerified: boolean("email_verified")
--     createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
-- drizzle adapter อ่านชื่อคอลัมน์จริงจาก object นี้ ไม่ได้ hard-code ชื่อใน SQL
-- ⚠ Better Auth เปลี่ยนคอลัมน์ตามเวอร์ชันได้: หลังติดตั้ง ให้รัน
--     npx auth@latest generate   → ได้ drizzle schema ของเวอร์ชันจริง
--     npx drizzle-kit generate   → diff กับไฟล์นี้
--   ถ้าต่างกัน ให้ยึดผลจาก generate แล้วอัปเดตไฟล์นี้ (อย่าแก้ฝั่ง drizzle ให้ตามไฟล์นี้)

create table "user" (
  id              text primary key,
  name            text not null,
  -- nullable ได้ เพราะ LINE Login ไม่คืนอีเมลถ้ายังไม่ได้รับอนุมัติสิทธิ์ email
  -- ผู้ใช้ LINE อาจไม่มีอีเมลเลย → มีหน้า "กรอกอีเมลภายหลัง" ไม่บังคับตอนสมัคร
  -- DB บังคับ lower-case + ไม่มีช่องว่างหัวท้าย: provider ที่ส่งตัวพิมพ์ใหญ่จะ "ล้มเสียงดัง" ทันที
  -- ดีกว่าได้ผู้ใช้ 2 คนที่อีเมลเดียวกันแบบเงียบ ๆ (unique ด้านล่างเทียบแบบ exact ไม่สนตัวพิมพ์)
  email           text check (email is null or email = lower(btrim(email))),
  -- LINE ไม่ถือว่าอีเมลยืนยันแล้ว (Better Auth ตั้ง false) → ห้ามใช้ email เป็นกุญแจเชื่อมบัญชี
  email_verified  boolean not null default false,
  image           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- unique แบบปล่อย NULL ซ้ำได้ (Postgres ไม่นับ NULL เป็นค่า) → ผู้ใช้ที่ไม่มีอีเมลมีได้หลายคน
  -- lookup `email = $1` ของ Better Auth ยังใช้ index นีได้ (แอปไม่ต้อง lower เอง — check ด้านบนคุมไว้แล้ว)
  unique (email)
);

create table session (
  id          text primary key,
  -- ผู้ใช้ถูก "ออกจากระบบ" เมื่อเลยเวลานี้ (ไม่ใช่ TTL ของ cache)
  expires_at  timestamptz not null,
  token       text not null unique,
  -- ใช้โชว์ "อุปกรณ์ที่ล็อกอินอยู่" ในหน้าตั้งค่าได้ในอนาคต
  ip_address  text,
  user_agent  text,
  user_id     text not null references "user"(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index session_user_id_idx on session (user_id);

create table account (
  id                        text primary key,
  -- id ของผู้ใช้ฝั่ง provider (Google sub / LINE userId) — ไม่เปลี่ยนตลอดชีพ
  account_id                text not null,
  -- 'google' | 'line' (อนาคตถ้าแยก channel ตามประเทศ: 'line-th', 'line-jp')
  provider_id               text not null,
  user_id                   text not null references "user"(id) on delete cascade,
  access_token              text,
  refresh_token             text,
  -- ⚠ เก็บ token ดิบใน DB ตรง ๆ — ควรเข้ารหัสที่ชั้นแอปถ้าจะเก็บระยะยาว
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  -- ไม่ใช้ (v1 ไม่มี email/password) แต่ Better Auth ต้องการคอลัมน์นี้ให้มี
  password                  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- 1 provider account ต่อ 1 ผู้ใช้ของเรา → ล็อกอินซ้ำไม่สร้าง user ใหม่
  unique (provider_id, account_id)
);

create index account_user_id_idx on account (user_id);

create table verification (
  id          text primary key,
  -- 'reset-password:<email>' หรือ identifier อื่นตามที่ Better Auth สร้าง
  identifier  text not null,
  value       text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index verification_identifier_idx on verification (identifier);

-- ---------------------------------------------------------------------------
-- ตารางของแอป
-- ---------------------------------------------------------------------------
-- หมายเหตุกันสับสน: "account" (เอกพจน์) = บัญชีล็อกอินของ Better Auth
--                        "accounts" (พหูพจน์) = กระเป๋าเงินของผู้ใช้ ← ตารางนี้คือกระเป๋า

create table accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null references "user"(id) on delete cascade,
  -- ห้ามชื่อว่าง/มีแต่ช่องว่าง (ไม่งั้น partial unique ด้านล่างจะปล่อยชื่อว่างได้คนละ 1 ตัว แล้วครั้งที่สอง error อ่านไม่รู้เรื่อง)
  name             text not null check (btrim(name) <> ''),
  kind             text not null default 'cash'
                     check (kind in ('cash', 'bank', 'credit', 'ewallet', 'other')),
  -- v1 ไม่แปลงข้ามสกุล → ล็อกที่ DB ไม่ใช่แค่ default (default อย่างเดียวปล่อยให้เขียน USD ได้เงียบ ๆ)
  currency         char(3) not null default 'THB' check (currency = 'THB'),
  -- ยอดตั้งต้น ณ วันเริ่มใช้แอป (สตางค์) · บัตรเครดิตใส่ค่าลบได้ (= ยอดที่ค้างจ่าย)
  -- เพดาน ±1e15 เท่ากับ amount: เกินกว่านี้บวกใน JS แล้วเพี้ยนเงียบ (เกิน Number.MAX_SAFE_INTEGER)
  initial_balance  bigint not null default 0
                     check (initial_balance > -1000000000000000 and initial_balance < 1000000000000000),
  icon             text,
  color            text,
  -- ซ่อนจากตัวเลือกในฟอร์ม แต่รายการเก่ายังอ้างถึงได้ (ห้ามลบ)
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- ซ้ำกับ PK โดยตั้งใจ: เป็นเป้าหมายของ composite FK (account_id, user_id) ในตาราง transactions
  -- → กันไม่ให้รายการอ้างกระเป๋าของ "ผู้ใช้อื่น" ได้ แม้แอปมีบั๊กหรือถูกยิง API ตรง
  unique (id, user_id)
);

-- กันชื่อซ้ำแบบตัวพิมพ์/ช่องว่าง: "เงินสด" กับ "เงินสด " ถือเป็นชื่อเดียว และหลัง archive สร้างชื่อเดิมได้
create unique index accounts_user_name_uidx
  on accounts (user_id, lower(btrim(name)))
  where archived_at is null;

create table categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references "user"(id) on delete cascade,
  -- หมวดแยกตามทิศทาง: หมวดรับใช้กับ expense ไม่ได้ (DB บังคับผ่าน composite FK ใน transactions)
  kind        text not null check (kind in ('income', 'expense')),
  name        text not null check (btrim(name) <> ''),
  -- ชื่อ emoji หรือ key ของ icon set ที่แอปใช้ ('utensils', 'bus', ...)
  icon        text,
  color       text,
  -- ลำดับที่ผู้ใช้จัดเองในหน้าตั้งค่าหมวดหมู่ (น้อยไปมาก)
  sort_order  integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- เป้าหมายของ composite FK (id, user_id): ให้ budgets อ้างหมวดได้โดยบังคับว่าเป็นหมวดของผู้ใช้คนเดียวกัน
  unique (id, user_id),
  -- เป้าหมายของ composite FK: (category_id, kind, user_id) → บังคับพร้อมกัน 2 อย่าง
  --   ก) หมวดต้องเป็นของผู้ใช้คนนี้  ข) kind ของหมวดต้องตรงกับ kind ของรายการ
  -- (มีทั้ง 2 unique เพราะ FK แต่ละตัวต้องการ unique ที่มีจำนวนคอลัมน์เท่ากันและชุดคอลัมน์ตรงกัน — ลำดับสลับได้)
  unique (id, kind, user_id)
);

create unique index categories_user_kind_name_uidx
  on categories (user_id, kind, lower(btrim(name)))
  where archived_at is null;

create table transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null references "user"(id) on delete cascade,
  kind           text not null check (kind in ('income', 'expense', 'transfer')),
  -- กระเป๋าต้นทาง: income = เข้ากระเป๋านี้, expense = ออกจากกระเป๋านี้, transfer = ออกจากกระเป๋านี้
  account_id     uuid not null,
  -- กระเป๋าปลายทางของ transfer เท่านั้น (income/expense ต้องเป็น null — บังคับใน check ด้านล่าง)
  to_account_id  uuid,
  category_id    uuid,
  -- สตางค์ เป็นบวกเสมอ ห้าม 0 · เพดาน 1e15 สตางค์ (= 10 ล้านล้านบาท) กันค่าที่เกิน safe integer ของ JS
  amount         bigint not null check (amount > 0 and amount < 1000000000000000),
  currency       char(3) not null default 'THB' check (currency = 'THB'),
  -- เวลาที่ "เกิดรายการ" (ผู้ใช้เลือกได้ ไม่ใช่เวลา insert) — ใช้ตัดยอดเดือน/ปี
  -- แก้ย้อนหลังได้ แต่ถ้าแก้แล้วยอดเดือนเปลี่ยน ต้อง revalidate cache สรุปของเดือนนั้น
  occurred_at    timestamptz not null default now(),
  -- งวดเดือนตามเวลาไทย (+07) ตรึงไว้ที่ DB → query หน้าสรุป/เทียบงบใช้งวดเดือนแบบ equality ได้
  -- และไม่มีเลข magic ±7 ชั่วโมงกระจายอยู่ในโค้ดแอป (ห้ามใช้ date_trunc(occurred_at) ตรง ๆ เพราะขึ้นกับ timezone ของ session)
  -- ใช้ interval '7 hours' ไม่ใช่ 'Asia/Bangkok' เพราะ timezone(text, timestamptz) เป็น stable → PG ไม่รับใน generated column
  -- ไทยไม่มี DST จึง +7 ตลอดปี · drizzle: ประกาศเป็น generatedAlwaysAs (ห้ามใส่ค่าตอน insert/update)
  occurred_month_bkk date generated always as
                      ((date_trunc('month', occurred_at at time zone interval '7 hours'))::date) stored,
  note           text,
  -- soft delete: ลบจริงห้ามทำ เพราะยอดเดือนที่เคยสรุปไปแล้วจะเปลี่ยนย้อนหลังโดยไม่มีร่องรอย
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- ---- ความถูกต้องระดับ DB (เงิน = ทางวิกฤต) ----
  foreign key (account_id, user_id)    references accounts (id, user_id),
  foreign key (to_account_id, user_id) references accounts (id, user_id),
  -- เมื่อ category_id เป็น null (transfer) FK นี้ถูกข้ามตาม MATCH SIMPLE
  foreign key (category_id, kind, user_id) references categories (id, kind, user_id),

  constraint transactions_shape_ck check (
    case when kind = 'transfer'
      then to_account_id is not null
       and to_account_id <> account_id          -- โอนเข้าตัวเองไม่มีความหมาย
       and category_id is null                  -- transfer ไม่มีหมวด (ไม่ต้องนับในยอดหมวด)
      else to_account_id is null
       and category_id is not null              -- รับ/จ่ายต้องมีหมวด เพื่อให้หน้าสรุปทำงานได้
    end
  )
);

-- ---- index ที่หน้าแรก/รายการทั้งหมด/สรุป ใช้จริง (มีเท่านี้ อย่าเพิ่มก่อนมี query) ----
-- หน้าแรก: รายการล่าสุด 20 รายการ · รายการทั้งหมด: keyset pagination ตาม occurred_at
-- ไม่มี OFFSET (OFFSET บนตารางที่โตขึ้นเรื่อย ๆ จะช้าลงเรื่อย ๆ)
create index transactions_user_recent_idx
  on transactions (user_id, occurred_at desc, id desc)
  where deleted_at is null;

-- หน้าสรุป/เทียบงบ + ยอดเดือนนี้แยก kind: ตัดเดือนด้วย equality ที่งวดเดือนไทย (occurred_month_bkk = date '2026-09-01')
-- include (amount, kind) ทำให้ sum(amount) group by kind เป็น index-only scan ไม่ต้องแตะ heap
-- (วัดจริงรอบ 2: Index Only Scan · Heap Fetches 0 · buffers 1 เทียบกับ 9 เดิม — minor 7.1)
-- ไม่ตัด transactions_user_kind_time_idx ในรอบนี้: รอวัดหน้าจริงก่อนว่ามี query ที่กรองช่วง occurred_at
-- ที่ไม่ตรงงวดเดือนอยู่หรือไม่ (ถ้าไม่มี จึงค่อยตัด = index บน transactions ลดจาก 6 เหลือ 5)
create index transactions_user_month_idx
  on transactions (user_id, occurred_month_bkk)
  include (amount, kind)
  where deleted_at is null;

-- ยอดเดือนนี้แยกตาม kind + แนวโน้ม 6 เดือน: sum(amount) group by kind, ช่วง occurred_at
-- include (amount) ทำให้เป็น index-only scan ไม่ต้องแตะ heap
create index transactions_user_kind_time_idx
  on transactions (user_id, kind, occurred_at)
  include (amount)
  where deleted_at is null;

-- สรุป: สัดส่วนรายจ่ายตามหมวดในเดือนหนึ่ง + เทียบกับ budgets
create index transactions_user_category_time_idx
  on transactions (user_id, category_id, occurred_at)
  include (amount)
  where deleted_at is null;

-- ยอดคงเหลือต่อกระเป๋า + รองรับ FK ตอนลบ user (cascade)/ย้ายกระเป๋า
-- ห้ามใส่ where deleted_at is null: PG ตรวจ FK ด้วย query ที่ไม่มีเงื่อนไขนี้
--   (SELECT 1 FROM ONLY transactions x WHERE account_id=$1 AND user_id=$2 FOR KEY SHARE OF x)
--   → index แบบ partial ถูกข้าม กลายเป็น Seq Scan ต่อ 1 แถวที่ลบ (พิสูจน์แล้วว่า enable_seqscan=off ก็ยัง Seq Scan)
create index transactions_account_idx
  on transactions (account_id, user_id);

-- เหมือนกัน: ห้ามใส่ where to_account_id is not null (FK ของ to_account_id ต้องใช้ index นี้)
create index transactions_to_account_idx
  on transactions (to_account_id, user_id);

create table budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null references "user"(id) on delete cascade,
  category_id   uuid not null,
  -- วันแรกของเดือน (Asia/Bangkok) เท่านั้น เช่น 2026-09-01 → ห้ามเก็บ 2026-09-15
  -- ตั้งใจไม่เก็บเป็น (year, month) 2 คอลัมน์ เพราะเทียบช่วง/เรียงเดือนง่ายกว่าและพลาดวันแรกยาก
  period_month  date not null,
  -- งบเป็นบวกเสมอ (สตางค์) · เกินงบหรือไม่คำนวณจากผลรวม expense ของเดือนนั้น
  amount        bigint not null check (amount > 0 and amount < 1000000000000000),
  currency      char(3) not null default 'THB' check (currency = 'THB'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  foreign key (category_id, user_id) references categories (id, user_id),
  unique (user_id, category_id, period_month),
  -- บังคับว่าต้องเป็นวันที่ 1 จริง (immutable expression → ใช้ใน check ได้)
  constraint budgets_period_month_ck check (period_month = date_trunc('month', period_month)::date)
);

-- budgets ควรมีแต่หมวด kind='expense' เท่านั้น — check ข้ามตารางไม่ได้
-- แอปต้องบังคับตอน insert/update (ตัวเลือกหมวดในหน้างบกรอง kind='expense' อยู่แล้ว)
-- (บังคับที่ DB ได้ด้วยคอลัมน์ category_kind + FK 3 คอลัมน์ — ยังไม่ทำ เลื่อนทั้งชุดพร้อมข้อ 4.2 ของ docs/schema-review.md)

-- ---------------------------------------------------------------------------
-- updated_at อัตโนมัติ
-- ---------------------------------------------------------------------------
-- ตารางของ Better Auth ไม่ใส่ trigger (ตัวไลบรารีเขียน updated_at เองอยู่แล้ว)
-- ส่วนตารางของแอปใช้ trigger เพื่อไม่ต้องพึ่งวินัยของทุก write path
create or replace function jodjai_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger accounts_touch     before update on accounts     for each row execute function jodjai_touch_updated_at();
create trigger categories_touch   before update on categories   for each row execute function jodjai_touch_updated_at();
create trigger transactions_touch before update on transactions for each row execute function jodjai_touch_updated_at();
create trigger budgets_touch      before update on budgets      for each row execute function jodjai_touch_updated_at();

-- ---------------------------------------------------------------------------
-- v2 เปลี่ยนอะไรจาก v1 (ตรวจกับ docs/schema-review.md ได้)
--   major 3.1 (ข) เกิดงวดเดือนไทยที่ DB: transactions.occurred_month_bkk (generated stored) + index (user_id, occurred_month_bkk) include (amount, kind)
--   major 1.1      currency ล็อก 'THB' ด้วย check ทั้ง accounts/transactions/budgets
--   major 6.1      user.email บังคับ lower(btrim(email))
--   minor 1.2      initial_balance มีเพดาน ±1e15 เหมือน amount
--   minor 1.3      แก้คอมเมนต์ 1e15 สตางค์ = 10 ล้านล้านบาท (เดิมเขียน 1 หมื่นล้าน — ผิด 1000 เท่า)
--   minor 4.1      ถอด partial predicate จาก transactions_account_idx / transactions_to_account_idx (FK ใช้ partial ไม่ได้)
--   minor 4.3      check btrim(name) <> '' ที่ accounts/categories
--   minor 4.5      แก้คอมเมนต์ที่อ้างว่า composite FK ต้องตรง "ลำดับ" คอลัมน์ (ไม่จริง — PG เทียบเป็นชุด + จำนวนต้องเท่า)
--   minor 7.1      เพิ่ม include (amount, kind) ให้ transactions_user_month_idx → ยอดเดือน/แนวโน้ม 6 เดือนเป็น index-only scan
--   ไม่ทำ (ตกลงกับ lead): 4.2 budgets expense-only (ต้องแก้ FK + ลบ unique (id,user_id) พร้อมกัน) · 4.4 index หน้ากระเป๋า (รอวัดข้อมูลจริง)
--   ยังไม่ทำ (ไม่มีโค้ด): 6.2 diff กับ `npx @better-auth/cli generate` — ต้องรันก่อน migrate จริงในเฟส 1

-- ---------------------------------------------------------------------------
-- ยังไม่ทำใน v1 (ใส่เมื่อขอ — อย่าเผื่อไว้)
--   * หมวดหมู่เริ่มต้น (เงินเดือน/อาหาร/เดินทาง) → seed ในแอปตอน onboarding ไม่ใช่ใน DDL
--   * ตาราง recurring / push subscription / export job
--   * materialized view สรุปเดือน → ยังไม่ต้อง ทำตอนหน้าสรุปช้าจริง (วัดก่อน)
--   * คอลัมน์ user_settings (timezone, วันเริ่มเดือน, ธีม) → v1 ล็อก Asia/Bangkok + เริ่มเดือนวันที่ 1
-- ============================================================================
