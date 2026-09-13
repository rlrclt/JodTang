
---

# query layer review — `src/db/queries/transactions.ts` (commit `91020f3`)

รีวิวโดย: reviewer · 2026-09-13 · ทางวิกฤต: เงิน + การแยกข้อมูลผู้ใช้
revision ที่ตรวจ: `src/db/queries/transactions.ts` md5 **`2590e2b11cddd033ace13028ef02539f`** ·
`src/db/queries/transactions.test.ts` md5 **`155605c3435bb0756430793057270293`**
→ md5 ตรงกับ `git show 91020f3:` ทั้งสองไฟล์ · **ไม่แก้โค้ด** ตามสั่ง

## คำสั่งที่รันจริง

```bash
node --test src/db/queries/transactions.test.ts     # tests 8 · pass 8 · fail 0  (ตรงกับที่ coder รายงาน)
grep -n "from(transactions)\|liveOf(userId)" …      # 3 จุดสร้าง query / 3 จุดใช้ liveOf
grep -nE "sum\(|reduce\(|amount *\+|\.sum\b" …      # ไม่พบการคำนวณเงินในไฟล์ query
node /tmp/probe-query/q.mjs                         # keyset กับเวลาซ้ำ + wildcard (fixture ของผมเอง)
node /tmp/probe-query/q2.mjs                        # เคสเดียวกันบนโค้ดที่ถูกถอด tie branch (เทียบ)
node /tmp/probe-query/plan.mjs                      # EXPLAIN ค่า default vs ปิด seqscan
cp -r src /tmp/mutq && (แก้ afterCursor) && node --test /tmp/mutq/src/db/queries/transactions.test.ts
```

## สรุป: ผ่าน 4/5 · ข้อที่ไม่ผ่าน = ข้อ 3 (เทสต์ keyset ไม่ครอบเคสเวลาซ้ำ) · ไม่มี blocker

| # | ประเด็น | ผล |
|---|---|---|
| 1 | ทุก path ผ่าน `liveOf()` (ตอนนี้ + อนาคต) | **ผ่าน** |
| 2 | ไม่มีสูตรเงินใน query layer · transfer กันสอดคล้อง | **ผ่าน** |
| 3 | keyset `(occurred_at,id) < cursor` + เวลาซ้ำ | โค้ด **ถูก** (พิสูจน์แล้ว) แต่ **เทสต์ไม่ครอบ** → ไม่ผ่าน (minor) |
| 4 | `ilike %search%` กับ wildcard | **ยอมรับไม่ได้แบบเงียบ** → ตัดสินให้ escape (1 บรรทัด · minor) |
| 5 | หลักฐาน index ด้วย `enable_seqscan = off` | **ผ่านในระดับ structural** (ระบุสิ่งที่ยังพิสูจน์ไม่ได้ + วิธีทำให้แข็งขึ้น) |

---

## (1) ทุก path ผ่าน `liveOf()` — ผ่าน

- `grep -n "from(transactions)"` เจอ **3 จุด** = 3 จุดที่สร้าง query จริง: `monthRows` (L75), `recentTransactionsQuery` (L103), `listTransactions` (L141)
- `grep -c "liveOf(userId)"` = **3** → ทั้ง 3 จุดใช้ `liveOf` เป็นเงื่อนไขแรก และไม่มีที่ไหนประกอบ `where` เองโดยไม่มีมัน ✓
- path อ้อมก็ผ่าน: `monthTotals` → `monthRows` ✓ · `monthExpenseByCategory` → `monthRows` ✓ · `recentTransactions` → `recentTransactionsQuery` ✓
- `listTransactions` ใช้รูปแบบ `const conditions = [liveOf(userId)]` แล้ว push ต่อ → ปลอดภัยเท่าที่ **ไม่มีใครสร้าง array ใหม่โดยไม่เริ่มจาก liveOf**
- `liveOf` ถูกประกาศเป็น const ระดับโมดูล **ไม่ export** → ไม่มีไฟล์อื่นเอาไปใช้ผิดบริบทได้ (แต่ก็แปลว่าไฟล์ query ที่สองต้องเขียน predicate ของตัวเอง — ถูกแล้ว เพราะ `accounts` ใช้ `archived_at` ไม่ใช่ `deleted_at`)
- **ข้อสังเกต (ไม่ใช่ข้อบกพร่อง · ไม่มี action ตอนนี้):** การบังคับ "ทุก path ต้องมี liveOf" เป็นวินัย + คอมเมนต์ ไม่ใช่ type-level
  ถ้าอนาคตมีไฟล์ query ที่สอง (accounts/categories/budgets) ให้เพิ่ม meta-test ที่ `.toSQL()` ของ builder ทุกตัว
  แล้ว assert ว่า SQL มี `user_id` **และ** `deleted_at is null` — จับ "ลืมกรอง" ได้ตอนเทสต์ ไม่ต้องรอเห็นข้อมูลคนอื่นในหน้าจอ
  (วันนี้ยังไม่ต้องทำ เพราะมีไฟล์เดียว + เทสต์ ข) ตรวจข้ามผู้ใช้ทั้งสองทิศแล้ว)

## (2) ไม่มีสูตรเงินใน query layer · transfer กันสอดคล้อง — ผ่าน

- `grep -nE "sum\(|reduce\(|amount *\+|\.sum\b"` → **ไม่พบ** การบวก/รวมเงินในไฟล์นี้เลย ✓
  ตัวเลขทุกตัวที่ออกจากชั้นนี้มาจาก `periodTotals()` / `expenseByCategory()` ใน `src/lib/money.ts` (import ที่ L13–20) ✓
- ไม่มี SQL `sum()` ด้วย → เงินไม่ถูกบวกสองที่ (DB ไม่ได้มีสูตรเงินสำรอง) — ตรงกับกติกา "เงินคิดที่ money.ts"
- transfer ถูกกัน **2 ชั้นสอดคล้องกัน**: ชั้น query `inArray(kind, MONEY_KINDS)` (L77) และชั้น money `isCounted()` → transfer ไม่มีทางเข้าไปในยอดเดือนไม่ว่าจะเรียกทางไหน ✓
- ตรวจกับ DB จริงในเทสต์: `transfer ถูกตัดออกจากรายการรับ/จ่ายของเดือน (แต่ยังอยู่ในตาราง)` — มี assert กับ DB ดิบว่า transfer มีอยู่จริง 1 แถว แล้วแถวที่คิดยอดไม่มี transfer ✓ (แบบเดียวกับที่ผมบังคับในรีวิว schema: "ต้องมีแถวอยู่จริง ไม่งั้นเทสต์ผ่านหลอก ๆ")
- ความต่างที่ตั้งใจ (ไม่ใช่ความไม่สอดคล้อง): `monthRows` = ชุดสำหรับ **คิดยอด** (ตัด transfer) · `listTransactions({periodMonth})` = ชุดสำหรับ **ดูรายการ** (ไม่กรอง kind → เห็น transfer ด้วย) ✓ ทั้งคู่มีคอมเมนต์กำกับ
- เทสต์ ก) ผูก invariant ไว้แล้ว: `monthTotals == periodTotals(rows)` ของชุดเดียวกัน + เทียบกับ "ค่าที่คิดมือล่วงหน้า" (SEPT_INCOME/SEPT_EXPENSE) → ไม่ใช่ derive จากโค้ดที่จะเทสต์ ✓ วิธีนี้ถูก

## (3) keyset — โค้ดถูก แต่เทสต์ไม่ครอบเคส "เวลาเท่ากันเป๊ะ" → ไม่ผ่าน (minor)

**โค้ดถูกต้อง** — `afterCursor` (L63–67) เป็น `lt(occurredAt) OR (eq(occurredAt) AND lt(id))` ตรงกับ `order by occurred_at desc, id desc` แบบ lexicographic ✓

พิสูจน์ด้วย fixture ที่ผมสร้างเอง (4+3+1 แถว โดย 4 แถวแรกเวลาเท่ากันเป๊ะ · 2 แถวถัดไปเวลาเท่ากันอีกชุด · limit 2):

```
หน้า: [04@09-20 03:00  03@09-20 03:00] → [02@09-20 03:00  01@09-20 03:00] → [07@09-19 03:00  06@09-19 03:00] → [05@09-19 03:00  08@09-18 03:00]
รวม 8 แถว · id ไม่ซ้ำ 8 · เรียง desc ตาม (occurredAt, id) ทั้งชุด: true · ครบทุกแถวใน DB (ไม่ข้าม): true
cursor = 02@09-20 03:00 (ส่ง id เดิมซ้ำ) → หน้าที่ได้ [01 07] · แถวที่ id เท่ากับ cursor ถูกตัดออก: true
```
= เวลาซ้ำไม่ข้าม/ไม่ซ้ำ · id เท่ากับ cursor ไม่ค้าง (ถูกตัดออกแล้วไปต่อ) ✓

**แต่ชุดเทสต์ปัจจุบันจับเคสนี้ไม่ได้เลย** — fixture ของเทสต์มีเวลาไม่ซ้ำกันแม้แต่คู่เดียว (10:00, 09:00, 08:30, 08:00, 19:00, 18:00, 12:00, 07:00)

หลักฐานเชิงกลไก: ผมคัดลอก `src/` ไป `/tmp/mutq` แล้วแก้ `afterCursor` ให้เหลือ `lt(transactions.occurredAt, cursor.occurredAt)` (ถอด tie branch = บั๊กจริง: แถวที่เวลาเท่ากับ cursor หายทั้งกลุ่ม)

```
node --test /tmp/mutq/src/db/queries/transactions.test.ts  →  tests 8 · pass 8 · fail 0   ← เทสต์ยังผ่าน
node /tmp/probe-query/q2.mjs (fixture เวลาซ้ำ + โค้ดที่ถูกถอด tie branch)
   → หน้า: [04 03] → [07 06] → [08] · รวม 5 แถว (ควรได้ 8) · ครบทุกแถว: false   ← แถวหาย 3 แถวแบบเงียบ
```
(สคริปต์ของผมแยกข้อบกพร่องที่เทสต์มองไม่เห็น — หายไป 3 แถว แต่ลำดับยัง "ดูถูกต้อง")

**เทสต์ที่ควรเพิ่ม (1 เคส — วางต่อท้ายเทสต์ keyset เดิมได้เลย):**

```ts
test('keyset: แถวที่ occurred_at เท่ากันเป๊ะ ต้องไม่ข้าม/ไม่ซ้ำ', async () => {
  // ต้องมีอย่างน้อย 3 แถวที่เวลาเท่ากัน (มี 2 แถวเท่ากันไม่พอจะแยก tie branch ออกจาก bug ได้)
  // paginate limit 2 ไล่จนหมด → assert: จำนวนรวม = จำนวนใน DB · id ไม่ซ้ำ · ทุกคู่เรียง desc ตาม (occurredAt, id)
});
```
เกณฑ์ผ่านที่ควรผูก: `all.length === raw count` และ `new Set(ids).size === raw count` และ strict desc **คู่ที่เวลาเท่ากันต้องเทียบ id ด้วย** (เทสต์เดิมเทียบแค่ `occurredAt` จึงผ่านได้แม้ลำดับ id ผิด)

## (4) `ilike %search%` กับ wildcard — ตัดสิน: **escape (1 บรรทัด)** · minor

ก่อนอื่น: **ไม่ใช่ช่องโหว่ความปลอดภัย** — ค่าถูกส่งเป็น parameter (`built.params`) ✓ ไม่มีทาง SQL injection และไม่ทำให้ข้ามผู้ใช้ (ยังอยู่ใน `and(...conditions)` ที่มี `liveOf`)

แต่ semantics ผิดแบบผู้ใช้เห็นได้ — วัดจริง (`/tmp/probe-query/q.mjs`, ตารางมี note: `กาแฟ ลด 50%`, `a_b`, `axb`, `ไม่มีอักขระพิเศษ` + อีก 8 แถว):

| ผู้ใช้พิมพ์ | pattern ที่ได้ | ผลที่ได้ | ควรเป็น |
|---|---|---|---|
| `50%` | `%50%%` | 1 แถว (ok โดยบังเอิญ — `%50%%` ≈ `%50%`) | 1 แถว |
| `%` | `%%%` | **12 แถว = ทุกแถวที่มี note** | เฉพาะ note ที่มี `%` |
| `_` | `%_%` | **12 แถว = ทุกแถว** | เฉพาะ note ที่มี `_` |
| `a_b` | `%a_b%` | **2 แถว: `a_b` และ `axb`** ← ผลผิดจริง ไม่ใช่แค่กว้างขึ้น | 1 แถว |
| `axb` | `%axb%` | 1 แถว | 1 แถว |

เคส `a_b` คือเคสที่ตัดสิน: ผู้ใช้พิมพ์ `_` แล้วได้รายการที่ไม่เกี่ยวข้อง — เกิดจาก `_` เป็น wildcard ของ LIKE
**ทางแก้ 1 บรรทัดที่จุดเดียว (L136):**

```ts
if (filters.search) {
  const esc = filters.search.replace(/[\\%_]/g, (m) => '\\' + m); // escape ตัวอักษรพิเศษของ LIKE
  conditions.push(ilike(transactions.note, `%${esc}%`));
}
```
ผลหลัง escape (วัดแล้ว): `"50%"` → เฉพาะ `กาแฟ ลด 50%` · `"%"` → เฉพาะ note ที่มี `%` จริง · `"a_b"` → เฉพาะ `a_b` ✓
(PG ใช้ `\` เป็น escape char ตาม default อยู่แล้ว จึงไม่ต้องเติม `escape '\\'`) · ต้องมีเทสต์คู่กัน 1 assert: `search: 'a_b'` → ได้ 1 แถว
เหตุผลที่ไม่เลือก "ยอมรับได้ในแอปส่วนตัว": ราคาแก้คือ 1 บรรทัด + 1 assert และอาการที่ได้คือ "ค้นแล้วเจอของที่ไม่เกี่ยว" ซึ่งทำให้ผู้ใช้เลิกเชื่อผลค้นหา — แพงกว่าค่าตัวแก้

**ข้อสังเกตข้างเคียง (ไม่มี action):** `COLUMNS` (L27–36) ไม่ได้ select `note` แต่ค้นหาด้วย `note` → หน้าผลลัพธ์แสดงข้อความที่ match ไม่ได้ ถ้าอยากให้ผู้ใช้เห็น "ทำไมแถวนี้ขึ้น" ต้องเพิ่ม `note` ใน select (ตัดสินพร้อม UI S4)

## (5) หลักฐาน index ด้วย `enable_seqscan = off` — ผ่านในระดับที่ระบุไว้เอง แต่ต้องรู้ว่าพิสูจน์อะไรได้/ไม่ได้

**สิ่งที่เทสต์นี้พิสูจน์ (ยอมรับได้ในฐานะด่าน dev):** "index ตัวนี้ *ใช้กับ query นี้ได้* และเรียงลำดับให้แล้ว"
ผมรันเองบนข้อมูลขนาดเทสต์ด้วยค่า default → planner เลือก `Seq Scan + Sort` จริงตามที่คอมเมนต์ของเทสต์อ้าง ✓
และเมื่อ `set enable_seqscan = off` → `Index Scan using transactions_user_recent_idx` **ไม่มี Sort** ✓ = SQL เป็น sargable และลำดับตรงกับ index จริง
ระดับนี้เรียกว่า **structural/compatibility evidence** — เหมาะเป็น gate ตอนพัฒนา ไม่ใช่หลักฐาน performance

**สิ่งที่ยังพิสูจน์ไม่ได้:** (ก) บนข้อมูลจริง planner จะ *เลือก* index นี้ (cost-based, ขึ้นกับ selectivity/stats) (ข) ความเร็ว/จำนวน buffer (ค) visibility map กับ index-only scan (ง) พฤติกรรมบน Neon + PgBouncer

**ทำอย่างไรให้แข็งขึ้น (งานของ coder/verifier ไม่ใช่ของรีวิวรอบนี้):**
1. seed ปริมาณใกล้จริงของผู้ใช้ 1 คน (เช่น ≥10k แถวของ u1 + อีก ≥1M แถวของผู้ใช้อื่น) → `ANALYZE` → `EXPLAIN (ANALYZE, BUFFERS)` **โดยไม่ปิด seqscan** แล้ว assert `not Seq Scan` + ไม่มี `Sort` + บันทึก buffers/เวลาไว้เทียบ
2. รันซ้ำบน Neon dev branch (planner + stats + visibility map จริง) แล้วเก็บ plan ลงเอกสาร — อันนี้คือหลักฐานระดับที่ใช้อ้าง acceptance ได้
3. เฟส 4: ใส่ budget เวลาจริง (เช่น query หน้าแรก < 100 ms บน branch dev) ให้ verifier วัด
4. หมายเหตุเล็ก: assert ด้วย **ชื่อ index** (`transactions_user_recent_idx`) จะพังเมื่อวันหนึ่งมี index ใหม่ที่ดีกว่า — ควรคง assert `ไม่มี Seq Scan` + `ไม่มี Sort` เป็นหลัก และเก็บข้อชื่อ index ไว้เป็น canary ที่รู้ว่าอาจต้องอัปเดต

หลักฐานระดับ "ข้อมูลจริงแต่ยังไม่ใช่ Neon" มีอยู่แล้วในรีวิว schema รอบก่อน: query หน้าแรกแบบเดียวกันบนข้อมูล ~5k แถว **ด้วยค่า default (ไม่ปิด seqscan)** ได้ `Index Only Scan using transactions_user_recent_idx · Heap Fetches 0 · 0.08 ms` (ดู `docs/schema-review.md` หัวข้อ 4) — ใช้เป็นหลักฐานประกอบได้เลย ไม่ต้องทำใหม่

---

## เกณฑ์ที่ผมยังไม่ตรวจ (บอกตรง ๆ)

- ยังไม่รันกับ Neon จริง (ไม่มี credential) — ข้อ 5 ระบุวิธีปิดช่องนี้ไว้แล้ว
- `src/db/index.ts` (3 บรรทัด) ไม่ได้รีวิว เพราะไม่ใช่ query path ที่คิดยอด/แยกข้อมูลผู้ใช้
- ไม่ได้ตรวจหน้าจอที่เรียก query layer (S2/S4/S5 ยังไม่ผูกกันในคอมมิตนี้ — คอมมิตนี้มีแต่ layer)
