# mutations review — write path (commit `9c5d7fd`)

รีวิวโดย: reviewer · 2026-09-13 · ทางวิกฤต: เงิน + สิทธิ์ผู้ใช้
revision ที่ตรวจ: `src/db/mutations/transactions.ts` md5 **`0034f78e1c16efa7a1983256f3d49f19`** ·
`src/db/mutations/transactions.test.ts` md5 **`44823183f950cb8eaabdfeea4321d5aa`** ·
`src/db/queries/transactions.ts` md5 **`e91f7c8fe2c54f2d4aa85ae28c66b762`**
→ md5 ตรงกับ `git show 9c5d7fd:` ทั้งสามไฟล์ · **ไม่แก้โค้ด** ตามสั่ง

## คำสั่งที่รันจริง

```bash
node --test src/lib/money.test.ts src/db/queries/transactions.test.ts src/db/mutations/transactions.test.ts
grep -rn "\.delete(\|delete from\|DELETE FROM" src/            # ไม่พบ DELETE จริง
node /tmp/probe-mut/m.mjs                                      # validate vs กติกา DB + patch occurredAt
node /tmp/probe-mut/mut.mjs                                    # mutation 6 แบบบนสำเนา /tmp/mutm (repo ไม่ถูกแตะ)
node /tmp/probe-mut/race.mjs                                   # อ่าน→เขียน ถูกตัดกลาง (deterministic)
git show 9c5d7fd -- src/db/queries/transactions.ts             # ตรวจว่า queries เปลี่ยนแค่ export
```

## สรุป: ผ่าน 4/5 · ข้อที่ไม่ผ่าน = ข้อ 3 · ไม่มี blocker

| # | ประเด็น | ผล |
|---|---|---|
| 1 | แยกผู้ใช้: ทุก statement ผูก `session.userId` + ปฏิเสธ input ที่แครี่ userId/id/deletedAt | **ผ่าน** (mutation M1/M2/M4 ถูกจับ) |
| 2 | validate ตรงกับ `transactions_shape_ck` + check ของ DB | **มีช่อง 2 กลุ่ม** (uuid format · FK owner/kind) → minor (B) |
| 3 | update: อ่าน→ประกอบ→validate ใหม่ | โครงถูก แต่ **คืน `undefined` เมื่อ WHERE ไม่ตรง** → minor (A) · และคำถาม (ก)/(ข) → (C)/(B) |
| 4 | soft delete: ไม่มี DELETE จริง · ลบของคนอื่นไม่ได้ | **ผ่าน** |
| 5 | เทสต์ 6 เคสพอไหม | **ผ่านสำหรับกติกาที่ประกาศไว้** (mutation 6/6) แต่ยังไม่ครอบ 3 เคสที่พบใหม่ |

`node --test` 3 ไฟล์ → **tests 30 · pass 30 · fail 0** (ตรงกับที่ coder รายงาน) ·
`queries/transactions.ts` diff = เปลี่ยนชื่อ `COLUMNS`→`TXN_COLUMNS` + `export toRows` เท่านั้น
(อ่าน diff แล้วไม่มี logic เปลี่ยน; ชุดเทสต์ queries ยัง 10/10 และไฟล์เทสต์เดิมไม่ถูกแตะ) ✓

---

## (1) การแยกผู้ใช้ — ผ่าน

statement ที่แตะข้อมูลมี 4 จุด และผูก session ครบ:
| statement | ผูกด้วย |
|---|---|
| `insert` (L134–147) | `userId: session.userId` (L137) — ค่ามาจาก session ไม่ใช่ input |
| `select` ของเดิมใน update (L174–177) | `ownLiveRow(session, rowId)` = `eq(id) AND eq(userId) AND isNull(deletedAt)` |
| `update` (L192–203) | `ownLiveRow(...)` |
| soft delete `update` (L216–220) | `ownLiveRow(...)` |

input ที่แครี่ฟิลด์ต้องห้าม → ปฏิเสธด้วย allow-list (`ALLOWED_KEYS`, L48–56) ก่อนแตะ DB ทุกกรณี
(`userId`, `user_id`, `id`, `deletedAt`, `currency` — เทสต์ไล่ครบทั้ง 5 + ฝั่ง update) และค่าที่เขียนลง DB
ถูก **หยิบทีละฟิลด์** จากผล validate (ไม่ spread input) = กันสองชั้น ✓

**mutation ยืนยัน (สำเนา `/tmp/mutm`, repo ไม่ถูกแตะ · baseline 30/30):**

| mutation | ผล |
|---|---|
| M1 ถอด `eq(userId)` ออกจาก `ownLiveRow` | **จับได้** (fail 1: เทสต์ update — รวม cross-user update + soft delete ของ u2) |
| M2 ถอด allow-list | **จับได้** (fail 2) |
| M4 insert ไม่ผูก `userId` กับ session | **จับได้** (fail 5) |
| M3 soft delete ไม่ตั้ง `deletedAt` | **จับได้** (fail 2) |
| M5 ถอดการตรวจรูปร่าง (shape) ใน validate | **จับได้** (fail 2) |
| M6 ถอดการตรวจช่วง amount | **จับได้** (fail 1) |

## (2) validate กับกติกา DB — มีช่อง 2 กลุ่ม (minor B)

**ทิศ "ผ่าน validate แต่ DB ปฏิเสธ" (มีจริง 4 เคสที่วัดได้):**

| อินพุต | validate | ผลจริงเมื่อยิง DB |
|---|---|---|
| `accountId: 'not-a-uuid'` | **ผ่าน** | `cause: invalid input syntax for type uuid` |
| `categoryId` = หมวด `income` (kind ไม่ตรง) | **ผ่าน** | `transactions_category_id_kind_user_id_fkey` |
| `accountId` = กระเป๋าของผู้ใช้อื่น | **ผ่าน** | `transactions_account_id_user_id_fkey` |
| `accountId` = uuid ที่ไม่มีอยู่ | **ผ่าน** | `transactions_account_id_user_id_fkey` |

ทั้ง 4 เป็นกฎที่ **ตรวจแบบ sync ไม่ได้** (ต้องถาม DB) → ถูกต้องที่ DB เป็นคนกัน
**แต่สิ่งที่หลุดถึงผู้เรียกคือ `DrizzleQueryError` ที่ `.message` มี SQL เต็ม + params เต็ม** เช่น
`Failed query: insert into "transactions" (...) values (...) params: u1,expense,not-a-uuid,...`
→ ถ้า server action แสดง/ล็อก `error.message` (สิ่งที่คนมักทำ) จะได้ทั้ง SQL หลุดหน้าจอและขัด
**กฎข้อ 2 ของไฟล์นี้เอง** ("ผู้ใช้ได้ข้อความไทย ไม่ใช่ error ดิบของ PG") + design §4 ("error ห้ามมีศัพท์เทคนิค")
(ข้อความ PG จริงอยู่ที่ `error.cause.message` — ซึ่งเทสต์ของ coder อ่านถูกแล้ว)

ทดสอบฝั่ง update พบช่องเดียวกันแต่ **ยังไม่มีเทสต์ครอบ** (เทสต์ (5) ยิงเฉพาะ add):
`update { accountId: 'xxx' }` → uuid error · `update { accountId: กระเป๋า u2 }` → FK · `update { categoryId: หมวด income }` → FK

**ทิศ "DB รับแต่ validate ปฏิเสธ" → ไม่พบ** (validate เข้มเท่าหรือมากกว่า DB ในทุกข้อที่ตรวจได้:
amount ช่วง/จำนวนเต็ม, kind, รูปร่าง transfer/รับ-จ่าย, currency ถูกกันด้วย allow-list, note ต้องเป็นข้อความ)

**ข้อเสนอ (เลือกทางใดทางหนึ่ง แล้วเขียนกฎข้อ 2 ให้ตรงความจริง):**
- (i) แปลงรหัส PG 3 ตัวเป็น `ValidationError` ที่ชั้นนี้ (ครอบ insert+update ที่จุดเดียว ~6 บรรทัด):
  `22P02` (uuid ผิดรูป) · `23503` (FK: กระเป๋า/หมวดไม่ใช่ของคุณ ไม่มีอยู่ หรือ kind ไม่ตรง) · `23514` (check)
  แล้วคงเทสต์ที่ assert `cause.message` ไว้ **เพื่อพิสูจน์ว่า DB เป็นคนกันจริง** (คนละ assertion กับข้อความที่ผู้ใช้เห็น)
- (ii) ยอมรับว่าปล่อยให้ DB error ผ่าน แต่ต้อง (ก) แก้คอมเมนต์กฎข้อ 2 (validate ตรวจได้แค่รูปร่าง/kind/amount) (ข) ระบุชัดว่า server action ห้ามแสดง `.message` (ค) เพิ่มเทสต์ฝั่ง update
**ผมแนะนำ (i)** เพราะราคาถูกและปิดทั้งการหลุด SQL และความไม่สอดคล้องกับ design §4

## (3) update path — โครงถูก แต่มี 3 เรื่อง

**โครงสร้าง (L160–206) ถูกต้อง:** อ่านของเดิม (เฉพาะของ session + ยังไม่ลบ) → ประกอบร่างใหม่จากค่าจาก DB แล้วทับด้วย patch → `validateTransaction()` ชุดเดิม → `update` (WHERE `ownLiveRow` อีกครั้ง) ✓
การ merge กัน `kind` เปลี่ยนไม่ได้ (validate อย่างเดียวกันไม่ได้เพราะ merge kind มาจาก DB) ด้วย pre-check `'kind' in patch` → `ValidationError` ✓ ถูกต้อง
ถ้า validate ไม่ผ่าน = ไม่มี SQL ถูกส่งเลย (เทสต์ยืนยันค่าเดิมใน DB ไม่เปลี่ยน) ✓

### (A) minor — ถ้าแถวถูกลบ "ระหว่าง" อ่านกับเขียน → `updateTransaction` **คืน `undefined` ไม่ throw**

พิสูจน์แบบกำหนดได้ (ไม่ใช่การเดา): `/tmp/probe-mut/race.mjs` intercept ที่ client ของ drizzle
ให้ soft delete แถวนั้นก่อนที่ SQL ของ update จะถูกส่ง (จำลอง: เปิดสองแท็บ แท็บหนึ่งลบ อีกแท็บกดบันทึก)

```
3) updateTransaction "ไม่ throw" → คืน undefined
   → ผู้เรียก (server action) จะได้ undefined แล้วไปพังตอนเข้าถึง property: TypeError → 500 (ไม่ใช่ข้อความไทย)
4) สถานะจริงใน DB: {"amount":10000,"deleted_at":"2026-09-13T05:05:31.484Z"}  ← ข้อมูลไม่เสียหาย (WHERE ไม่ตรง ✓)
5) เทียบ softDelete ในสถานการณ์เดียวกัน → ValidationError: ไม่พบรายการนี้ (อาจถูกลบไปแล้วหรือไม่ใช่ของคุณ)  ← guard ที่ update ยังไม่มี
```
และ `toRows([])[0] === undefined` (ชนิดที่ประกาศคือ `Promise<TxnRow>` → ชนิดไม่ตรงกับความจริงในเคสนี้)
**ข้อเสนอ 3 บรรทัด:** หลัง update ให้ตรวจ `if (rows.length === 0) throw new ValidationError('ไม่พบรายการนี้ (อาจถูกลบไปแล้วหรือไม่ใช่ของคุณ)')` แบบเดียวกับ soft delete + เพิ่มเทสต์จำลอง race (หรืออย่างน้อยเทสต์ `update` แล้ว 0 แถว)

### (ก) `patch { occurredAt: null }` / `''` = "ไม่แก้" — ตั้งใจได้ แต่ต้องมีคอมเมนต์/เทสต์

วัดจริง: ส่ง `occurredAt: null` หรือ `''` → ค่าใน DB **คงเดิม** ไม่ error และค่าที่คืนมาก็เป็นวันที่เดิม
(เพราะโค้ดใส่ `occurredAt` เฉพาะเมื่อมีค่า — ถูกต้อง เพราะคอลัมน์เป็น `not null` = ล้างไม่ได้อยู่แล้ว)
คำตอบ: **เจตนารับได้ แต่เป็นกับดักที่ต้องเขียนกำกับ** เพราะ `add` กับ `update` ให้ความหมายต่างกัน:
`add` ที่ไม่ส่ง = DB ใส่ `now()` · `update` ที่ส่ง `null` = คงเดิม (เงียบ) → docstring 2 บรรทัด + assert 1 ตัว
(ไม่งั้นวันที่คนอ่านเอกสาร/เทสต์จะเข้าใจว่า "ส่ง null = ล้าง" แล้วพังเงียบ ๆ)

### (ข) ไม่มี pre-check ว่า account/category เป็นของผู้ใช้ → ความเห็น

**เห็นด้วยกับ "DB เป็นคนกัน"** (validate เป็น sync ตรวจ ownership/การมีอยู่ไม่ได้ และไม่ควรยิง query เพิ่มในนี้)
**ไม่เห็นด้วยกับ "ปล่อย error ดิบถึงผู้ใช้"** เหตุผลตามข้อ (2): `.message` ของ drizzle มี SQL เต็ม
→ สรุปคำตอบ: กลไกกันถูกแล้ว แต่ต้องปิดช่องการสื่อสารด้วยการแปล (2i) หรืออย่างน้อยเขียนกฎให้ชัด (2ii)
ไม่งั้นคอมเมนต์กฎข้อ 2 ของไฟล์จะกลายเป็นคำโฆษณาที่ไม่จริงในเส้นทางนี้

## (4) soft delete — ผ่าน

- `grep -rn "\.delete(\|delete from\|DELETE FROM" src/` → **ไม่พบ DELETE จริงที่ไหนเลย** ✓ มีแต่ `update ... set deletedAt`
- ตั้ง `deletedAt` ผ่าน `ownLiveRow(session, id)` (L219) = `id + userId + isNull(deletedAt)` ✓ ลบของคนอื่น/ของที่ลบแล้วไม่สำเร็จ
- เทสต์: ยอดเดือนลดลงหลังลบ · แถวยังอยู่ในตาราง (`deleted_at` ไม่ null) · ลบซ้ำ → ValidationError · แก้ของที่ลบแล้วไม่ได้ ✓
- mutation M3 (ถอดการตั้ง `deletedAt`) → เทสต์ fail ✓ (ทั้งการหายจากยอดและการลบซ้ำ)
- หมายเหตุเล็ก: ลบซ้ำ "ไม่สำเร็จ" เป็นเจตนา (คืน ValidationError) — ข้อความบอกผู้ใช้แล้ว ✓

## (5) เทสต์ 6 เคสพอไหม — พอสำหรับกติกาที่ประกาศไว้ (mutation 6/6 ถูกจับ)

สิ่งที่ยังไม่มีเทสต์ (มาจากข้อ (A)/(B)/(C) — เพิ่ม 3 เคส):
1. FK/uuid ฝั่ง **update** (ปัจจุบันมีแต่ฝั่ง add)
2. `patch { occurredAt: null }` = คงเดิม (ไม่แก้ ไม่ error)
3. `update` ที่ WHERE ไม่ตรง (เคส race → ต้องได้ ValidationError ไม่ใช่ undefined)

ของที่ดีอยู่แล้วและควรคงไว้: เทสต์ (5) ที่ assert ชื่อ constraint จาก `cause` (พิสูจน์ว่า DB เป็นคนกันจริง ไม่ใช่แค่ assert ผ่าน) · การนับแถว `countRows()` ก่อน/หลังทุกเคสที่ต้องไม่แตะ DB · เทสต์ (2) ที่ไล่ 16 เคสละเมิดทีละข้อ

---

## เกณฑ์ที่ยังไม่ได้ตรวจ (บอกตรง ๆ)

- ไม่ได้รีวิว server action / หน้าจอ (ยังไม่มีในคอมมิตนี้) — ข้อ (2)/(ข) จะปิดที่ชั้นนั้นได้เหมือนกัน แต่ต้องมีที่ไหนที่หนึ่งรับผิดชอบชัดเจน
- ไม่ได้รัน `next build` / `eslint` ซ้ำ (coder รายงาน exit 0 / 0 warning — ไม่ใช่ขอบเขต 5 ข้อนี้)
- ไม่ได้ทดสอบ concurrency ระดับ Neon จริง — เคส race จำลองบน PGlite แบบกำหนดได้ (พอสำหรับพิสูจน์ว่า guard หาย)
