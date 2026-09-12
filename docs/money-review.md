# money review — src/lib/money.ts (commit `e8e4f5b`)

รีวิวโดย: reviewer · 2026-09-13
ไฟล์: `src/lib/money.ts` md5 `2bc35535392937ddae26da7db9d9a4bd` · `src/lib/money.test.ts` md5 `45186d4b84219a4046f7b3c6d4068545`
→ md5 ตรงกับ blob ใน commit `e8e4f5b` **และ** ตรงกับ working tree (ไม่มี edit ค้างใน 2 ไฟล์นี้)
ไฟล์ทั้งสอง **ไม่ถูกแก้** — ข้อเสนอทั้งหมดอยู่ในเอกสารนี้

## คำสั่งที่รันจริง (ผลตามจริง)

```bash
node --test src/lib/money.test.ts          # tests 5 · pass 5 · fail 0 · exit 0 (node v26.8.2)
node /tmp/pgtest/mutate.mjs                # mutation test 6 แบบบนสำเนาใน /tmp/mut (ไม่แตะไฟล์จริง)
node /tmp/pgtest/money-probe.mjs           # ตัวเลข/พฤติกรรมทุกตัวที่อ้างในเอกสารนี้
node /tmp/pgtest/drift.mjs                 # เคสผลรวมเพี้ยน 1 สตางค์
tsc -p . (replica tsconfig โปรเจกต์ + typescript@5 + @types/node@20)   # 0 error
grep -rn "/ *100\|\* *100\|toFixed\|Math.round\|parseFloat" src/       # เจอแค่ money.ts:94
```

## สรุป

| # | ประเด็นที่สั่งเพ่ง | ผล |
|---|---|---|
| 1 | กติกาตรง schema.sql ข้อ 1–4 | **ผ่าน** |
| 2 | transfer ไม่เข้า income/expense แต่เข้า accountBalance 2 ฝั่ง | **ผ่าน** |
| 3 | soft delete ไม่กระทบยอดรวม transfer | **ผ่าน** |
| 4 | ผลรวมใช้ JS number — ปลอดภัยจริงไหม | **ไม่ผ่าน (minor)** ไม่มี guard และไม่มีความหมายอะไรหยุดไว้ |
| 5 | formatSatang ที่เดียวที่หาร 100 + integer guard | **ผ่าน** (ข้อเสนอ 1 คำ: `isInteger` → `isSafeInteger`) |
| 6 | เทสต์ครอบเคสที่ควร fail พอไหม | **พอ** — mutation 6/6 ถูกจับ + ช่องว่างเล็ก 3 จุด |

ไม่มี blocker · ที่ควรแก้รอบนี้คือ 2 บรรทัด (ข้อ 4) + 1 คำ (ข้อ 5) + เพิ่ม assert 3 บรรทัด

---

## 1) กติกา schema.sql ข้อ 1–4 — ผ่าน

- **ข้อ 1 (bigint สตางค์, ห้าม numeric/float):** `grep` ทั้ง `src/` เจอการหาร/คูณ 100 แค่ `money.ts:94` ที่เดียว
  และไม่มี `toFixed`/`Math.round`/`parseFloat` ที่ไหนเลย ✓ · ไม่มี `Number` แบบทศนิยมถูกสร้างขึ้นในไฟล์นี้
- **ข้อ 2 (amount เป็นบวก ทิศทางมาจาก kind):** `formatRowAmount` ตัดสินเครื่องหมายจาก `kind` ✓
  และ `accountBalance` บวก/ลบตาม `kind` ไม่ใช่ตามเครื่องหมายของ `amount` ✓
- **ข้อ 3 (ทุก query ต้องมี `user_id = session user`):** ไฟล์นี้ไม่ query — เป็นหน้าที่ผู้เรียก
  ไฟล์เขียนกติกาข้อ 3 ไว้ในหัว comment ว่า "ชั้น query ตอนเฟส 2 ต้องดึง `MONEY_KINDS` ไปใช้กับ
  `inArray() + isNull(deletedAt)`" แต่ **ไม่ได้เตือนเรื่อง `user_id`** → เติมครึ่งบรรทัดในคอมเมนต์หัวไฟล์
  ให้ครบทั้ง 2 เงื่อนไข (`user_id` + `isNull(deletedAt)`) จะกันคนลืมตอนเฟส 2 (เอกสารล้วน ไม่ใช่โค้ด)
- **ข้อ 4 (soft delete):** ทั้ง `isCounted` และ `accountBalance` กรอง `deletedAt` ✓ (ดูข้อ 3 ด้านล่าง)
- `occurred_month_bkk` (คอลัมน์ใหม่ v2) ถูกอ้างถูกต้องในคอมเมนต์หัวไฟล์ — ตรงกับ schema v2 ✓

## 2) transfer — ผ่าน

- **ไม่เข้ายอดรับ/จ่าย:** `isCounted` รับเฉพาะ `income`/`expense` → `periodTotals` ข้าม transfer ✓
- **เข้า 2 ฝั่งกระเป๋า:** `accountBalance` หักฝั่ง `accountId` และบวกฝั่ง `toAccountId` ของแถวเดียวกัน ✓
  (`transfer A→B`: A −amount, B +amount · ยอดรวมทุกกระเป๋าไม่เปลี่ยน — ถูกต้องเชิงโครงสร้าง)
- ประโยชน์ของ "1 transfer = 1 แถว" ตาม schema: ไม่มีทางที่ฝั่งใดฝั่งหนึ่งค้าง ✓
- **หลักฐานเชิงกลไก (mutation):** พลิกด้าน transfer (`sum += accountId` / `sum -= toAccountId`) → เทสต์ fail ทันที (M4) ✓
  และถ้าปล่อยให้ transfer ถูกนับเป็นรับ/จ่าย → เทสต์ fail (M3) ✓
- ช่องเดียวที่ DB กันไว้ให้ (ไม่ใช่บั๊กของไฟล์นี้): transfer ที่ `to_account_id` เป็น null ทำ "เงินหาย" ได้
  ถ้าหลุดมาจากชั้นอื่น — `transactions_shape_ck` ห้ามไว้แล้ว (ดูเอกสาร schema-review)

## 3) soft delete — ผ่าน

- แถวที่ลบแล้ว: `isCounted` = false ✓ · `accountBalance` `continue` ทันที ✓ (รวม transfer)
- **mutation ยืนยันว่ามีเทสต์กันจริง:** ลบ `if (row.deletedAt) continue;` ออกจาก `accountBalance` →
  เทสต์ fail (actual 1666554 vs expected 111000 = leaked deleted income 999999 + leaked deleted transfer 555555) ✓
- **หมายเหตุสำคัญเรื่องความหมายของเทสต์ (minor, ไม่ใช่บั๊ก):** บรรทัดที่ 34
  `accountBalance(A) + accountBalance(B) === 210000` **ตรวจจับ transfer ที่รั่วไม่ได้เลย**
  เพราะ transfer ย้ายเงินระหว่าง 2 กระเป๋า → บวกฝั่งหนึ่งลบอีกฝั่ง หักล้างกันพอดี
  (ตัวที่จับได้จริงคือบรรทัด 31 ที่ assert ยอด A ตรง ๆ)
  → เปลี่ยนบรรทัด 34 ให้ assert ยอด A และ B แยกกัน (`accountBalance(ROWS, A) === 110_000`) ให้ตรงกับคอมเมนต์
  "ต้องไม่ขยับยอดเลย" ที่มันอ้าง

## 4) ผลรวมใช้ JS number — ไม่ผ่าน (minor แต่ควรแก้รอบนี้)

**คำตอบสั้น: ปลอดภัยสำหรับข้อมูลจริง แต่ไม่มีอะไรหยุดมันถ้าหลุด และราคาที่ต้องจ่ายคือ 2 บรรทัด**

ตัวเลขที่วัดจริง (`node money-probe.mjs`):

| เคส | ผล |
|---|---|
| เพดานความแม่นยำ | `Number.MAX_SAFE_INTEGER` = 9,007,199,254,740,991 สตางค์ = **90.07 ล้านล้านบาท** |
| 30,000 แถว × 1,000 บาท | 3,000,000,000 สตางค์ · **เป๊ะ** · ห่างเพดาน 3,002,400 เท่า |
| ต้องกี่แถวที่ 1,000 บาท/แถวจึงจะเกิน | 90,071,992,548 แถว → **ข้อมูลจริงแตะไม่ได้** |
| 11 แถวที่ขนาดเพดานต่อแถว (`<1e15` ตาม schema) | โค้ดคืน `9999999999999992` · ค่าจริง `9999999999999991` → **เพี้ยน 1 สตางค์** |
| ตอนเพี้ยน `Number.isInteger` / `formatSatang` | `true` / พิมพ์ `฿99,999,999,999,999.92` **ไม่ throw** |

แปลว่า: เคสที่จะพังต้องมีแถวขนาด ~1e15 สตางค์ (≈ 1 หมื่นล้านบาท/แถว) ซึ่งผู้ใช้พิมพ์ไม่ได้
แต่ **DB ยอมรับได้ถึง 1e15** (เพดานใน schema) และ `initialBalance` เป็นพารามิเตอร์ที่ **ไม่ถูกตรวจอะไรเลย**
(`accountBalance([], 'a', 12.5)` คืน 12.5) → ทางหลุดมีจริง 2 ทาง และอาการคือ "ยอดผิดเงียบ ๆ"
ซึ่งเป็นอาการที่ไฟล์นี้ตั้งใจจะไม่ยอมให้เกิดตั้งแต่แรก (มัน throw ให้ 120.5 สตางค์)

**ข้อเสนอ (เลือก guard ไม่ใช่แค่คอมเมนต์ — คอมเมนต์ไม่หยุดบั๊ก): 3 บรรทัด**

```ts
// periodTotals(): ก่อน return
if (!Number.isSafeInteger(income) || !Number.isSafeInteger(expense)) {
  throw new TypeError(`ยอดรวมเกินสตางค์ที่แทนได้แม่นยำ (income=${income}, expense=${expense})`);
}
// accountBalance(): ก่อน return ใช้แบบเดียวกันกับ sum
// formatSatang(): Number.isInteger → Number.isSafeInteger  (1 คำ — ยัง throw 120.5 เหมือนเดิม)
```
`Number.isSafeInteger` ครอบทั้ง "ไม่ใช่จำนวนเต็ม" และ "เกิน 2^53" ในตัวเดียว — เพดานของมัน
(90.07 ล้านล้านบาท) ตรงกับเพดานต่อแถวที่ schema เลือกไว้แล้ว จึงไม่ต้องมีตัวเลข magic เพิ่ม
อย่าลืม: `sum()` ฝั่ง Postgres เป็น `numeric` = เป๊ะเสมอ ถ้าฝั่งแอปไม่เป๊ะ เท่ากับสองฝั่งตอบไม่ตรงกัน

**ตรวจข้อเสนอแล้ว (ไม่ใช่ข้อสันนิษฐาน):** เปลี่ยน `Number.isInteger` → `Number.isSafeInteger` ในสำเนา
แล้วรันเทสต์เดิม → **pass 5 fail 0** (ไม่พังของเดิม) และ `isSafeInteger(120.5) = false` (ยัง throw ตามเทสต์)
· `isSafeInteger(1e16) = false` (จับเคสใหม่ได้) · `isSafeInteger(250_000) = true` (ค่าปกติผ่าน)

## 5) formatSatang — ผ่าน (+ 1 คำ)

- เป็นที่เดียวที่หาร 100 ✓ (grep ทั้ง `src/` เจอบรรทัดเดียว) · guard มี ✓
- `Intl.NumberFormat("th-TH", {currency:"THB"})` + `signDisplay:"always"` สำหรับ signed ✓
  เทสต์ใช้ regex หลวม (`/2,500\.00/`, `/^[-−]/`) ไม่ผูกกับ ICU version → ทนกว่า assert สตริงเต็ม ✓
- `Number.isInteger` → **`Number.isSafeInteger`** (ตามข้อ 4): `1e16` ยังเป็น integer จึงผ่าน guard ปัจจุบันได้
- ข้อควรรู้ฝั่ง caller (ไม่ใช่บั๊ก): driver คืน `bigint`/`numeric` เป็น **string** — ถ้าส่ง `"250000"` เข้ามา
  guard จะ throw (fail-loud ✓) เพราะฉะนั้นชั้น map ต้อง `Number()` หรือ drizzle `{ mode: "number" }` ให้เสร็จ

## 6) เทสต์ครอบเคสที่ควร fail พอไหม — พอ (หลักฐานเชิงกลไก)

Mutation test บนสำเนา (`/tmp/mut`, ไฟล์จริงไม่ถูกแตะ) — แต่ละแถวคือ "ทำให้โค้ดผิดแบบหนึ่ง" แล้วดูว่าเทสต์จับได้ไหม:

| mutation | ผล |
|---|---|
| M1 `accountBalance` ไม่กรอง `deletedAt` | **จับได้** (fail 1) |
| M2 `isCounted` ไม่กรอง `deletedAt` | **จับได้** (fail 2) |
| M3 `isCounted` นับ transfer ด้วย | **จับได้** (fail 2) |
| M4 transfer กลับด้าน (บวกฝั่งต้นทาง) | **จับได้** (fail 1) |
| M5 `formatSatang` ไม่หาร 100 | **จับได้** (fail 1) |
| M6 income/expense ใน `accountBalance` กลับด้าน | **จับได้** (fail 1) |

= **6/6 mutant ถูกฆ่า** ชุดเทสต์มีฟันจริง ไม่ใช่เทสต์ที่ผ่านเพราะไม่ตรวจอะไร

ช่องว่างเล็กที่ยังไม่มีเทสต์ (เพิ่มได้ 3-4 `assert` เมื่อแก้ข้อ 4 และข้อ 2):
1. `formatSatang(1e16)` ต้อง throw (หลังเปลี่ยนเป็น `isSafeInteger`)
2. ยอดรวมเกิน 2^53 ต้อง throw (หลังใส่ guard)
3. `kind` ที่ไม่รู้จัก / transfer ที่ไม่มี `toAccountId` → ต้องไม่ถูกหักเงียบ ๆ (ดูข้อ 7)
4. `accountBalance(ROWS, A)` เขียน assert ตรง ๆ แทน invariant ที่เป็นกลางต่อ transfer (ข้อ 3)

## 7) เจอเพิ่ม (minor — 2 บรรทัด, มาจากการยิงแถวรูปแปลก)

`accountBalance` และ `isCounted` **fail-open** กับค่าที่ไม่ตรงสัญญา (ยิงจริง):

| อินพุต | ผลวันนี้ |
|---|---|
| `kind: 'bogus'` (ไม่อยู่ใน 3 kind) | ถูกหัก −100 ราวกับเป็น transfer (`else` รับทุกอย่างที่ไม่ใช่ income/expense) |
| `kind: 'transfer'`, `toAccountId: null` | −100 → เงินหายจากระบบ 100 สตางค์ |
| `deletedAt: ''` (falsy) | นับว่า **ยังไม่ถูกลบ** → แถวที่ลบแล้วกลับเข้ายอด |

DB กันไว้ทั้ง 3 กรณีแล้ว (`transactions_shape_ck` + check `kind`) จึงไม่ใช่บั๊กที่เกิดได้จากข้อมูลจริง
แต่ไฟล์นี้เป็น "ที่เดียวที่ตัดสินกติกาเงิน" — ให้มัน fail-closed จะตรงกับเจตนามากกว่า:
`!row.deletedAt` → `row.deletedAt == null` และ `} else {` → `} else if (row.kind === 'transfer') {`
(ถ้าอนาคตมี kind ที่ 4 มันจะไม่แอบไปหักกระเป๋าแทน — ตอนนี้จะหักเงียบ ๆ)

## ไม่ใช่ปัญหา (บันทึกไว้ให้จบ)

- node เตือน `MODULE_TYPELESS_PACKAGE_JSON` ตอนรันเทสต์ — อย่าไปใส่ `"type": "module"` ใน package.json
  (จะพัง config ของ Next) · เป็นแค่ warning ของ node ไม่กระทบผลเทสต์
- `tsc -p .` ผ่าน 0 error (ทำใน /tmp ด้วย tsconfig ของโปรเจกต์ + typescript@5 + @types/node@20
  เพราะโปรเจกต์ยังไม่ได้ `npm install`) · `allowImportingTsExtensions: true` มีอยู่แล้ว จึงไม่ติด TS5097
  จากการ import `"./money.ts"`

## ที่ยังไม่ได้ตรวจ (บอกตรง ๆ)

- ไม่ได้รัน `next build` / `eslint` (โปรเจกต์ยังไม่มี `node_modules` — ไม่ใช่ของ commit นี้)
- ไม่ได้ทดสอบกับข้อมูลจาก DB จริง: การแปลง `bigint → number` ที่ชั้น drizzle (เฟส 2) ยังไม่มีโค้ด
  ถ้าชั้นนั้นส่ง string เข้ามา ระบบจะ throw ทันที (fail-loud) ไม่ใช่เพี้ยนเงียบ — ยืนยันได้ตอนมี query layer
