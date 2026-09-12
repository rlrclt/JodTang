# จดจ่าย (JodJai) — SETUP: ขอ credential 3 อย่าง

คู่มือนี้ทำตามทีละขั้น ใช้เวลารวมประมาณ 30–45 นาที (ไม่รวมเวลารอ LINE อนุมัติ)
ทำเสร็จแล้วจะได้ค่า env ครบ 8 ตัวตามตารางท้ายไฟล์ → ก๊อปใส่ `.env` แล้วเฟส 1 เริ่มได้

อ้างอิง: `docs/PLAN.md` §2 (stack + env), §3 (ล็อกอิน Google/LINE), §7 (คำถามที่ค้างอยู่)

> **สถานะตอนทำ:** ยังไม่ต้องมีโค้ดในเครื่อง เอกสารนี้ขอ credential ล้วน ๆ
> ค่าทั้งหมดเป็นความลับ — ห้าม commit `.env` (ดูข้อ "กันพลาด" ท้ายไฟล์)

---

## 0. เตรียมก่อนเริ่ม (2 นาที)

- [ ] สร้าง `.env` ที่ root ของโปรเจกต์ (ยังไม่ต้องมีค่าครบ)
- [ ] สร้าง `.env.example` ที่มีแต่ชื่อตัวแปร ไม่มีค่า → อันนี้ commit ได้
- [ ] สร้าง `BETTER_AUTH_SECRET` ได้เลยตอนนี้ ไม่ต้องรอที่ไหน

```bash
openssl rand -base64 32
```

ก๊อปผลลัพธ์ใส่ `BETTER_AUTH_SECRET` — **สร้างครั้งเดียว ใช้ตลอด** อย่าสร้างใหม่ทีหลัง
เพราะ session ที่เซ็นไว้จะใช้ไม่ได้ทั้งหมด (ทุกคนถูกไล่ออกจากระบบ)

**ตัดสินใจ 1 ข้อก่อนไปต่อ** (PLAN §7 ข้อ 3): บังคับล็อกอินก่อนใช้ หรือให้ลองใช้แบบ local ก่อน
lead แนะนำ **บังคับล็อกอิน** เพราะข้อมูลการเงินควรผูกบัญชีตั้งแต่แรก — ไม่กระทบขั้นตอนด้านล่าง

---

## 1. Neon — ฐานข้อมูล Postgres

### 1.1 สร้าง project

- [ ] ไปที่ https://neon.com (หรือ console.neon.tech) → สมัคร/ล็อกอิน (Google ก็ได้)
- [ ] **Create project**
  - **Name:** `jodjai`
  - **Postgres version:** เลือก **17** ขึ้นไป (schema นี้verified บน PG 18.3 — อย่าต่ำกว่า 15)
  - **Region:** **Singapore (ap-southeast-1)** ← ใกล้ไทยที่สุด latency ต่ำสุด
  - **Compute:** อันเล็กสุดพอ (free tier) — ข้อมูลผู้ใช้คนเดียวยังน้อยมาก

### 1.2 เอา connection string 2 แบบ

Neon ให้ connection string มา **2 แบบจากหน้าเดียวกัน** ต้องเก็บทั้งคู่

- [ ] เปิด **Dashboard → Connect** (ปุ่มที่มุมขวาบนของ project)
- [ ] จะเห็นสวิตช์ **Connection pooling**

| เปิด pooling? | hostname ที่ได้ | เอาไปใส่ |
|---|---|---|
| ✅ เปิด (ค่าเริ่มต้น) | `ep-xxx-pooler.ap-southeast-1.aws.neon.tech` | `DATABASE_URL` |
| ⬜ ปิด | `ep-xxx.ap-southeast-1.aws.neon.tech` (ไม่มี `-pooler`) | `DATABASE_URL_DIRECT` |

- [ ] ก๊อป **แบบ pooled** → ใส่ `DATABASE_URL`
- [ ] ปิดสวิตช์ pooling → ก๊อป **แบบ direct** → ใส่ `DATABASE_URL_DIRECT`
- [ ] เติม `?sslmode=require` ท้ายทั้งสองอันถ้าไม่มีมาให้
- [ ] **เอา password ออกจากที่จดสาธารณะ** — Neon โชว์ password เต็มในสตริง ถ้าหลุดให้ reset ที่ Connect → Reset password

### 1.3 ทำไมต้องแยก 2 อัน (อ่านก่อนสลับที่กัน)

**pooled = PgBouncer โหมด transaction** ของ Neon
- ✅ ใช้ในแอป: serverless function เปิด–ปิด connection ถี่มาก ถ้าต่อตรงจะชนเพดาน connection ของ Postgres เร็ว
- ❌ **รัน DDL / migration ไม่ได้** — โหมด transaction ผูก connection แค่ระดับ transaction ทำให้ prepared statement และ session state (advisory lock, `SET`, temp table) ข้าม statement ไม่ได้ drizzle-kit migrate พึ่งของพวกนี้ → พัง

**direct = ต่อเข้า Postgres ตรง**
- ✅ `drizzle-kit migrate` / `psql` รัน DDL
- ❌ ถ้าเอาไปใช้ในแอปตอน production จะกิน connection หมดอย่างรวดเร็ว

**กฎที่ล็อกไว้** (schema.sql บรรทัด 4–6 เขียนไว้แล้ว):
- `DATABASE_URL` → แอปเท่านั้น
- `DATABASE_URL_DIRECT` → migration เท่านั้น
- รัน schema: `psql "$DATABASE_URL_DIRECT" -f docs/schema.sql`

> ⚠️ อย่าเผลอตั้ง `DATABASE_URL` เป็นตัว direct "เพราะมันใช้งานได้" — จะผ่านตอน dev แล้วไปตายตอน deploy บน Vercel ที่จำนวน connection พุ่ง

### 1.4 dev ไม่ต้องแยก branch ก็ได้ (แต่แนะนำ)

Neon free tier ทำ **branch** ได้ — แยก `main` (prod) กับ `dev` ได้ข้อมูลคนละชุด
PLAN §2 ระบุว่าเครื่อง dev นี้ไม่มี `psql`/`sqlite3` จึงใช้ Neon branch เป็น DB ตอนพัฒนา
ถ้าทำ: สร้าง branch `dev` แล้วเอา connection string ของ **branch นั้น** มาใส่ `.env` ตอน dev

---

## 2. Google Cloud Console — OAuth client

### 2.1 สร้าง project + ตั้ง consent screen

- [ ] ไปที่ https://console.cloud.google.com → **Create project** ตั้งชื่อ `jodjai`
- [ ] **APIs & Services → OAuth consent screen**
  - **User type:** **External** (ผู้ใช้ทั่วไป ต้องเป็นอันนี้)
  - **App name:** `จดจ่าย` · **User support email:** อีเมลคุณ · **Developer contact:** อีเมลคุณ
  - **Scopes:** ใส่นี้พอ — `openid`, `email`, `profile` (Better Auth ขอแค่นี้)
- [ ] **Publishing status ยังเป็น "Testing" ก็พอสำหรับ dev** แต่ต้องทำข้อถัดไป ไม่งั้นล็อกอินไม่ได้

- [ ] ⚠️ **กับดักอันดับ 1: เพิ่มตัวเองเป็น Test user**
      OAuth consent screen → **Test users → Add users** → ใส่อีเมล Google ที่จะใช้ทดสอบ
      ถ้าไม่ทำ จะเจอ **"Access blocked: จดจ่าย has not completed the Google verification process"** ตอนกดล็อกอิน
      (เจอบ่อยมาก และข้อความ error ไม่บอกว่าต้องทำอะไร)

### 2.2 สร้าง OAuth client

- [ ] **APIs & Services → Credentials → Create credentials → OAuth client ID**
- [ ] **Application type: `Web application`** ← ต้องเป็นอันนี้เท่านั้น
      (อย่าเลือก "Desktop app" — ไม่รองรับ redirect URI แบบที่เราต้องใช้)
- [ ] **Name:** `jodjai-web`

- [ ] **Authorized JavaScript origins** → เพิ่ม
  ```
  http://localhost:3000
  ```
- [ ] **Authorized redirect URIs** → เพิ่ม
  ```
  http://localhost:3000/api/auth/callback/google
  ```

- [ ] กด **Create** → ได้ **Client ID** และ **Client secret** → ใส่ `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

### 2.3 กับดักที่ต้องรู้

- **redirect URI ต้องตรงเป๊ะทุกตัวอักษร** — scheme, host, port, path
  - `http` ≠ `https` · `localhost` ≠ `127.0.0.1` · มี `/` ปิดท้าย ≠ ไม่มี
  - ผิดนิดเดียวได้ `Error 400: redirect_uri_mismatch` ซึ่งไม่บอกว่าคุณพิมพ์อะไรผิด
- **secret ไม่ได้โชว์อีก** หลังปิดหน้าต่าง — กด **Download JSON** เก็บไว้ หรือไปสร้างใหม่ที่ Credentials → คลิกชื่อ client
- ยังไม่ต้องใส่ production domain ตอนนี้ — เฟส 1 ล็อกอินบน dev ให้ผ่านก่อน ค่อยกลับมาเพิ่ม `https://<domain>/api/auth/callback/google` (PLAN §3)

---

## 3. LINE Developers — LINE Login channel

### 3.1 สร้าง provider + channel

- [ ] ไปที่ https://developers.line.biz → ล็อกอินด้วย LINE ของคุณ
- [ ] **Create a provider** → ตั้งชื่อ เช่น `JodJai` (provider = "เจ้าของ" ของ channel)
- [ ] **Create a channel** → เลือก **LINE Login** ← ต้องเป็นอันนี้
      (อย่าเลือก Messaging API — callback/scope คนละชุด ใช้กับ Better Auth ไม่ได้)
  - **Channel name:** `จดจ่าย`
  - **App type:** **Web app**
  - **Email address:** อีเมลคุณ

### 3.2 ใส่ callback URL

- [ ] เข้า channel → แท็บ **LINE Login** → **Callback URL** → ใส่
  ```
  http://localhost:3000/api/auth/callback/line
  ```
  LINE ยอมให้ใช้ `http://localhost` ตอน dev (ต่างจาก Google ที่เรื่องนี้ก็ยอม)

- [ ] ⚠️ กด **Update** ให้แน่ใจว่าบันทึกแล้ว — หน้านี้ไม่ auto-save

### 3.3 เอา channel ID / secret

- [ ] แท็บ **Basic settings** → **Channel ID** → `LINE_CLIENT_ID`
- [ ] **Channel secret** → `LINE_CLIENT_SECRET`

### 3.4 ⭐ สิทธิ์อีเมล — ข้อที่ทำให้ทีมต้องรอ

**ค่าเริ่มต้น: LINE Login ไม่คืนอีเมลให้** ต้องยื่นขอแยก และ **รอ LINE อนุมัติ**

- [ ] ยื่นคำขอที่ channel → แท็บ **LINE Login** → หัวข้อ **Email address permission** → **Apply**
      (ชื่อเมนูอาจขยับตามที่ LINE ปรับคอนโซล — หาคำว่า "email" ในหน้า LINE Login)

**สิ่งที่ต้องรู้ก่อนตัดสินใจ (PLAN §3 ข้อ 1, §7 ข้อ 2):**

| | ถ้ายังไม่อนุมัติ | ถ้าอนุมัติแล้ว |
|---|---|---|
| ล็อกอินได้ไหม | ได้ | ได้ |
| ได้อีเมลไหม | **ไม่ได้ → `email` เป็น `null`** | ได้ |
| ใช้เป็นกุญแจเชื่อมบัญชีได้ไหม | ไม่ได้ | **ก็ยังไม่ได้** — LINE ไม่ถือว่าอีเมลยืนยันแล้ว |

- **รออนุมัติหลายวันทำการ** — ไม่ใช่ทันที เริ่มยื่นวันนี้จะได้เร็วที่สุด
- ระหว่างรอ **ทุกอย่างเดินต่อได้** schema ออกแบบรองรับไว้แล้ว: `user.email` เป็น nullable (schema.sql บรรทัด 40–44)
  และมีหน้า "กรอกอีเมลภายหลัง" ไม่บังคับตอนสมัคร — LINE user ที่ไม่มีอีเมลอยู่ร่วมกันได้หลายคน (unique ปล่อย NULL ซ้ำได้)
- ⚠️ **ข้อควรระวังตอน scaffold:** ถ้าโค้ดขอ scope `email` ทั้งที่ยังไม่อนุมัติ LINE อาจ **error ตอนล็อกอิน** ไม่ใช่แค่คืน null
  ตอนเฟส 1 ให้ coder เริ่มด้วย scope `openid profile` ก่อน แล้วค่อยเพิ่ม `email` เมื่ออนุมัติผ่าน
  **ต้องตรวจกับเวอร์ชัน Better Auth จริง** ว่า default scope ของ provider `line` คืออะไร แล้วปรับให้ตรง

### 3.5 เรื่องอนาคต (ยังไม่ต้องทำ)

LINE แยก channel ตามประเทศ — channel นี้ใช้กับผู้ใช้ไทย
ถ้าวันหนึ่งรองรับ JP/TW ต้องสร้าง channel เพิ่มและตั้ง `providerId` แยก (`line-th`, `line-jp`) ผ่าน generic OAuth plugin (PLAN §3 ข้อ 2)

---

## 4. ตาราง env ทั้งหมด → `.env`

ก๊อปบล็อกนี้ใส่ `.env` แล้วเติมค่าที่เก็บมา

```bash
# ---- ฐานข้อมูล (Neon) ----
DATABASE_URL=            # pooled  — ใช้ในแอป (§1.2)
DATABASE_URL_DIRECT=     # direct  — ใช้ drizzle-kit migrate เท่านั้น (§1.3)

# ---- Better Auth ----
BETTER_AUTH_SECRET=      # openssl rand -base64 32 (§0)
BETTER_AUTH_URL=         # dev: http://localhost:3000  · prod: https://<domain>

# ---- Google (§2) ----
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ---- LINE (§3) ----
LINE_CLIENT_ID=
LINE_CLIENT_SECRET=
```

| ตัวแปร | ได้จากหน้าไหน | หมายเหตุ |
|---|---|---|
| `DATABASE_URL` | Neon → Connect → เปิด pooling | มี `-pooler` ใน host · **แอปเท่านั้น** |
| `DATABASE_URL_DIRECT` | Neon → Connect → ปิด pooling | ไม่มี `-pooler` · **migrate เท่านั้น** |
| `BETTER_AUTH_SECRET` | ไม่ได้จากคอนโซล — สร้างเอง | `openssl rand -base64 32` · อย่าสร้างใหม่ภายหลัง |
| `BETTER_AUTH_URL` | ไม่ได้จากคอนโซล — ตั้งเอง | dev `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` | Google Cloud → Credentials → OAuth client | |
| `GOOGLE_CLIENT_SECRET` | หน้าเดียวกัน (โชว์ครั้งเดียว) | กด Download JSON เก็บไว้ |
| `LINE_CLIENT_ID` | LINE Developers → channel → Basic settings | |
| `LINE_CLIENT_SECRET` | หน้าเดียวกัน (Channel secret) | |

**Callback URL ที่ต้องกรอกในคอนโซล (dev)**

| เจ้า | ค่าที่ใส่ |
|---|---|
| Google | `http://localhost:3000/api/auth/callback/google` |
| LINE | `http://localhost:3000/api/auth/callback/line` |

ตอนขึ้น production ต้องกลับมาเพิ่ม `https://<domain>/api/auth/callback/google` และ `.../line` ทั้ง 2 ที่

---

## 5. กันพลาด

- [ ] **`.env` ต้องอยู่ใน `.gitignore`** — ตรวจก่อน commit แรก ไฟล์นี้มี secret 4 ตัว
- [ ] `.env.example` ใส่แต่ชื่อตัวแปร ไม่มีค่า → commit ได้ ใช้เป็นเอกสาร
- [ ] `BETTER_AUTH_SECRET` ตั้งใน Vercel เป็น env var ตอน deploy ไม่ใช่ในโค้ด
- [ ] Neon/Vercel free tier: ระวัง **Neon scale-to-zero** — ครั้งแรกที่ยิงจะช้า 1–2 วิ (ยอมรับได้ใน v1, PLAN §8)
- [ ] ถ้า secret หลุด (เผลอ commit / แปะในแชท) → **rotate ทันที**: Neon Reset password · Google สร้าง client ใหม่ · LINE ไม่มีปุ่ม reset ให้สร้าง channel ใหม่

---

## 6. เช็คว่าครบหรือยัง

ก่อนบอกทีมว่าเริ่มเฟส 1 ได้ ตรวจ 4 ข้อนี้

- [ ] `.env` มีค่าครบ 8 ตัว ไม่มีตัวไหนว่าง
- [ ] `DATABASE_URL` มี `-pooler` · `DATABASE_URL_DIRECT` ไม่มี
- [ ] Google: เพิ่มตัวเองเป็น **Test user** แล้ว + redirect URI ตรงเป๊ะ
- [ ] LINE: กด **Update** callback URL แล้ว + **ยื่นขอ email permission แล้ว** (ต่อให้ยังไม่อนุมัติ)

---

## 7. สิ่งที่ยังต้องรอ / ยังค้าง

| ข้อ | สถานะ | ผลถ้าไม่ทำ |
|---|---|---|
| LINE email permission | **รอ LINE อนุมัติ (หลายวัน)** | ผู้ใช้ LINE ไม่มีอีเมล — แอปทำงานได้ แต่ต้องมีหน้ากรอกอีเมลภายหลัง |
| โดเมนจริง (PLAN §7 ข้อ 1) | **รอคุณตอบ** | ใส่ prod callback URL ไม่ได้ — dev ทำต่อได้เลย |
| บังคับล็อกอินไหม (PLAN §7 ข้อ 3) | **รอคุณตอบ** | lead แนะนำบังคับ · ไม่กระทบการขอ credential |
| `npx @better-auth/cli generate` เทียบ schema | รอผลตรวจ (งาน 6.2) | ถ้า diff ออกมา ต้องแก้ `docs/schema.sql` **ก่อน** migrate จริง |
