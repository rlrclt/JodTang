# accounts/categories review — query + mutation + การย้าย errors (HEAD `51ec73d`)

รีวิวโดย: reviewer · 2026-09-13 · ทางวิกฤต: ข้อมูลผู้ใช้ + ความหมาย archive
revision ที่ตรวจ (md5 ตรงกับที่แจ้งทุกไฟล์ · `git show <commit>:<file>` เทียบแล้ว):

| ไฟล์ | md5 | commit |
|---|---|---|
| `src/db/errors.ts` | `1ac5e2499eaa9bde58b08adef9f91a74` | 59d7a87 +1 บรรทัดใน 51ec73d |
| `src/db/session.ts` | `0520d3c31aabedace471ddb438e0aa27` | 59d7a87 |
| `src/db/queries/accounts.ts` | `d82512d08f3664d0961f939598fa0c09` | 51ec73d |
| `src/db/queries/categories.ts` | `14dea421fdd74ca86a8c2afa865a72e6` | 51ec73d |
| `src/db/mutations/accounts.ts` | `07f76113e71b57c5e9363fbdf3c23921` | 51ec73d |
| `src/db/mutations/categories.ts` | `21f68cb7e774d60a7b0473c0b9daf12d` | 51ec73d |
| `src/db/mutations/accounts.test.ts` | `05a7879ffd3bcf2b2f532fcdc4b330d1` | 51ec73d |
| `src/db/mutations/categories.test.ts` | `35834254a5a2bbc3c0ed115cea8c797d` | 51ec73d |
| `src/db/mutations/transactions.ts` | `62d43c43bbd2f826071d2ac6dc1120dc` | 59d7a87 (ย้ายออก) |

## คำสั่งที่รันจริง

```bash
node --test src/lib/money.test.ts src/db/queries/*.test.ts src/db/mutations/*.test.ts   # 45/45
node /tmp/probe-acct/ac2.mjs      # พฤติกรรมจริง 6 ข้อ (fixture แยกส่วน)
node /tmp/probe-acct/mut.mjs      # mutation 7 แบบบนสำเนา /tmp/mutac (repo ไม่ถูกแตะ)
git show 59d7a87 -- src/db/errors.ts src/db/mutations/transactions.ts src/db/session.ts
```

## สรุป: ผ่านครบ 6 ข้อ · ไม่มี blocker · มี 3 nit ที่ไม่บล็อก

| # | ประเด็น | ผล |
|---|---|---|
| 1 | แยกผู้ใช้ของ 2 ตารางใหม่ (`ownActiveAccount`/`ownActiveCategory`) | **ผ่าน** (mutation M1/M2/M7 ถูกจับ) |
| 2 | archive semantics | **ผ่าน** (หายจากลิสต์ active · รายการเก่ายังอ้าง+ยังนับยอด · แก้/archive ซ้ำไม่ได้) |
| 3 | unique/23505 (พิมพ์ใหญ่/ช่องว่าง · คนละ kind · ใช้ซ้ำหลัง archive) | **ผ่าน** (ข้อความไทยสะอาด · index อยู่ใน cause) |
| 4 | `initial_balance` (ติดลบได้ · ±1e15 · ชนิด) | **ผ่าน** |
| 5 | categories เปลี่ยน kind ไม่ได้ | **ผ่าน** (กันที่ชั้นแอป + พิสูจน์ว่า DB กันจริงด้วย FK) |
| 6 | refactor `errors.ts` = ย้ายจริง + mapping จุดเดียว | **ผ่าน** |

หมายเหตุจำนวนเทสต์: เครื่องผมวัดได้ **45/45** (money 14 · queries/transactions 10 · mutations/transactions 9 · mutations/accounts 6 · mutations/categories 6)
· ที่คุณรายงาน 43/43 อาจเป็นการรันก่อนไฟล์เทสต์ชุดสุดท้าย — ไม่ใช่ปัญหา แค่ให้ตัวเลขตรงกัน

## (1) แยกผู้ใช้ — ผ่าน

`grep` ยืนยัน: ไฟล์ใหม่ทั้ง 4 ไม่มี `deletedAt`/`liveOf` หลุดมาเลย (มีแต่คอมเมนต์เตือน) ✓ และทุก statement ที่แตะข้อมูลผูก `userId` ของ session:
`ownActiveAccount` = `eq(id) AND eq(userId) AND isNull(archivedAt)` · `ownActiveCategory` = แบบเดียวกันกับ `categories`
· ใช้ใน `addAccount` (insert ผูก `userId: session.userId`), `updateAccount` (select + update), `archiveAccount`, และคู่เดียวกันของ categories
· ฝั่งอ่าน `listAccounts`/`listCategories` ใช้ `eq(userId) + isNull(archivedAt)` ✓

**mutation บนสำเนา (baseline 45/45 · repo ไม่ถูกแตะ):**

| mutation | ผล |
|---|---|
| M1 ถอด `eq(userId)` จาก `ownActiveAccount` | **จับได้** (fail 1) |
| M2 ถอด `eq(userId)` จาก `ownActiveCategory` | **จับได้** (fail 1) |
| M3 ถอด `isNull(archivedAt)` (แก้ของ archive ได้) | **จับได้** (fail 3) |
| M4 ถอด allow-list ของ `validateAccount` | **จับได้** (fail 1) |
| M5 ถอด pre-check `kind` ของ `updateCategory` | **จับได้** (fail 1) |
| M6 ถอดการตรวจช่วง `initialBalance` | **จับได้** (fail 1) |
| M7 ถอด `eq(userId)` จาก `listAccounts` (query) | **จับได้** (fail 1) |

ข้อความเดียวกับ "ไม่มีอยู่" ✓ (anti-enumeration): `updateAccount` ของ u2 / `archiveAccount` ของ u2 / `updateCategory` ของ u2 /
`archiveCategory` ของ u2 / uuid ที่ไม่มีอยู่ → ได้ `ไม่พบกระเป๋านี้ (อาจถูก archive ไปแล้วหรือไม่ใช่ของคุณ)` เหมือนกันหมด · ของ u2 ไม่ถูกแก้ ✓
allow-list ทำงาน: `userId`, `id`, `archivedAt`, `currency` ถูกปฏิเสธ (add และ update) ✓

## (2) archive semantics — ผ่าน

วัดจริง: สร้างกระเป๋า + รายการ 18,500 สตางค์ → `listAccounts` เห็น 1 กระเป๋า, `monthTotals.expense = 18500`
→ `archiveAccount` → **หายจากลิสต์ active (0 กระเป๋า)** แต่ `monthTotals.expense` ยัง = 18500 ✓
→ `join transactions ⋈ accounts where archived_at is not null` ยังเจอรายการเก่า ✓ (FK ไม่พังเพราะไม่ได้ลบ)
→ `updateAccount` ของที่ archive แล้ว และ `archiveAccount` ซ้ำ → `ValidationError` ✓ (หมวดก็เหมือนกัน)

## (3) unique / 23505 — ผ่าน

| เคส | ผลจริง |
|---|---|
| ชื่อซ้ำต่างพิมพ์ใหญ่ (`b-cash` vs `B-Cash`) | `ValidationError: มีชื่อนี้อยู่แล้ว` · ข้อความไม่มี SQL |
| ชื่อซ้ำ + ช่องว่างหัวท้าย (`  B-Cash  `) | เหมือนกัน (validate trim ก่อน → ชน `lower(btrim(name))` ของ DB) |
| ชื่อเดียวกันคนละ kind (หมวด) | **ผ่าน** (unique ผูก `kind`) |
| ใช้ชื่อเดิมซ้ำหลัง archive | **ผ่าน** (partial unique `where archived_at is null`) |
| ชื่อซ้ำใน kind เดียวกัน (หมวด) | `ValidationError: มีชื่อนี้อยู่แล้ว` |
| พิสูจน์ว่า DB กันจริง | ✓ ชื่อ index (`accounts_user_name_uidx` / `categories_user_kind_name_uidx`) + รหัส `23505` อยู่ใน cause chain |

## (4) initial_balance — ผ่าน

ติดลบผ่านจริง (`-250000` = ยอดค้างจ่ายบัตรเครดิต ✓) · `+1e15` และ `-1e15` → `ValidationError: ยอดตั้งต้นเกินช่วงที่ระบบรองรับ` (ตรงกับ check `> -1e15 and < 1e15` ของ DB เป๊ะ) ·
`1e15-1` ผ่าน ✓ · สตริง `'100'` และ `12.5` → ปฏิเสธด้วยข้อความจาก `toSatang` (ตัวเดียวกับที่ใช้กับ `amount` — กติกาช่วงเป็นของตารางนี้เอง ไม่ใช่ `> 0`) ✓

## (5) categories เปลี่ยน kind ไม่ได้ — ผ่าน (พร้อม trade-off ที่บันทึกไว้)

- ชั้นแอป: `updateCategory(..., { kind })` → `ValidationError: เปลี่ยนประเภทหมวดไม่ได้ — ให้ archive แล้วสร้างใหม่` ✓ (mutation M5 ยืนยันว่ามีเทสต์กัน)
- **คำอ้างในคอมเมนต์ถูก** — พิสูจน์กับ DB: raw `update categories set kind='income'` ของหมวดที่มีรายการอ้าง →
  `violates foreign key constraint "transactions_category_id_kind_user_id_fkey"` (23503) ✓ = เปลี่ยนแล้วรายการเก่าพังจริงตามที่คอมเมนต์ว่า
- **trade-off ที่ตั้งใจ:** ถ้าหมวดยังไม่มีรายการอ้าง DB ปล่อยผ่าน (ทดสอบแล้ว) แต่ชั้นแอปยังปฏิเสธเสมอ
  → ผู้ใช้ที่พิมพ์ kind ผิดก่อนมีรายการ ต้อง archive + สร้างใหม่ (ราคาที่รับได้ และเขียนไว้ในคอมเมนต์แล้ว)
  ถ้าอนาคตอยากผ่อน: เช็ค "มีรายการที่ยังไม่ลบอ้างหมวดนี้ไหม" 1 query ก่อนอนุญาต

## (6) การย้าย errors.ts — ผ่าน (ตรวจจาก diff ไม่ใช่คำบอก)

- เทียบชุดบรรทัดที่ "ลบจาก transactions.ts" กับ "เพิ่มใน errors.ts" (ตัด import/คอมเมนต์ออก) → ต่างกันแค่ 2 อย่าง:
  `async function guardWrite` → `export async function guardWrite` และ `Session` ย้ายไป `src/db/session.ts` (+2 บรรทัด, มีคอมเมนต์กำกับ)
  = **ไม่มีการเปลี่ยน logic** ✓ (และเทสต์ 45/45 ยังผ่าน = พฤติกรรมเดิม)
- error mapping ยังเป็น **จุดเดียวจริง**: `DB_ERROR_MESSAGES`/`toUserError`/`guardWrite` อยู่ใน `errors.ts` ไฟล์เดียว
  และทั้ง 3 ไฟล์ write path import `guardWrite` จาก `../errors.ts` ✓ (transactions.ts เก็บ `export { ValidationError, toUserError }` ไว้ให้เทสต์เดิม import ได้ — ยังมีผู้ใช้จริง ไม่ใช่ dead code)
- การทำงานจริงกับตารางใหม่: 23505 ของ accounts/categories ถูกแปลเป็นข้อความไทย ✓ (ดูข้อ 3) · `51ec73d` เพิ่มรหัส `23505` เข้า map 1 บรรทัด ✓

## nit ที่ไม่บล็อก (แก้เมื่อสะดวก)

1. **ข้อความ log ใน `errors.ts` อ้างตารางผิด** — `console.error('[jodjai] transaction write rejected by DB:', error)`
   ตอนนี้ accounts/categories ก็เรียกทางนี้ → log จะบอกว่า "transaction" ทั้งที่อาจเป็นกระเป๋า/หมวด (ตัดคำว่า transaction ออก หรือทำเป็น generic) · 1 บรรทัด
2. **ข้อความ allow-list ต่อท้ายด้วยเหตุผลที่ไม่ตรงกับฟิลด์** — `ไม่อนุญาตให้ส่งฟิลด์ currency (userId มาจาก session เท่านั้น)`
   วงเล็บอธิบายถูกเฉพาะกรณี `userId` · ที่เหลือ (currency/archivedAt/id) เหตุผลจริงคือ "ระบบกำหนดเอง" → ควรใช้ข้อความกลาง ๆ
   เช่น `ไม่อนุญาตให้ส่งฟิลด์ ${key} จาก input` (ทั้ง 3 ไฟล์) · เป็นข้อความที่ผู้ใช้เห็น จึงควรอ่านแล้วไม่ชวนงง
3. **ความไม่สมมาตรของชนิดพารามิเตอร์ระหว่างชั้น** — mutation รับ `Session` แต่ query รับ `userId: string`
   (ตั้งใจและ TS จับได้ แต่ถ้าเรียกจาก JS/ทดสอบจะพลาดแบบเงียบ ๆ: ส่ง session object เข้า `listAccounts` → ได้ลิสต์ว่าง ไม่ error
   — รอบแรกของ probe ผมเองก็พลาดแบบนี้ จึงบันทึกไว้เป็นกับดักของผู้อ่าน ไม่ใช่ข้อบกพร่อง)

## ยังไม่ตรวจ / ค้างจากรีวิวก่อน

- ไม่ได้รีวิว UI/server action ที่เรียก 2 ตารางนี้ (ยังไม่มีในคอมมิตนี้)
- **un-archive ยังไม่มีในเลเยอร์นี้** (ตามที่ schema review เคยเตือน): วันที่เพิ่มปุ่ม "กู้คืนกระเป๋า" ต้องดัก 23505
  เพราะ partial unique อาจชนชื่อที่ถูกใช้ไปแล้ว — ขณะนี้ยังไม่มีทางกู้คืน จึงยังไม่ต้องทำ
- ไม่ได้รัน `next build`/`eslint` ซ้ำ (coder รายงาน exit 0 / 0 warning — ไม่ใช่ขอบเขต 6 ข้อนี้)
