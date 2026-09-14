#!/usr/bin/env node
/**
 * e2e smoke — ตรวจ flow ที่ต้องมี "session จริง" (ยอดเงิน · รายการ · งบ · ถังขยะ · ส่งออก · ตั้งค่าอีเมล)
 *
 * รัน: BASE_URL=http://127.0.0.1:3600 DATABASE_URL_DIRECT=postgres://… BETTER_AUTH_SECRET=… node scripts/e2e-smoke.mjs
 *
 * หลักการ
 *   1. **ไม่มี dependency ใหม่**: ใช้ `pg` ถ้ามีในเครื่อง (CI ติดตั้งด้วย --no-save) ไม่มีก็ใช้ `@neondatabase/serverless`
 *      (Neon) — สคริปต์จึงรันได้ทั้ง Postgres ปกติและ Neon branch dev
 *   2. **seed ด้วย SQL ตรง** (ไม่ผ่านแอป) แล้วตรวจว่า HTML ที่แอปเรนเดอร์ = ตัวเลขที่ "คำนวณจาก DB" จริง
 *   3. **คุกกี้ session ต้องเซ็นถูก**: better-auth เก็บ token ดิบใน DB และส่งคุกกี้เป็น
 *      `<token>.<base64(HMAC-SHA256(secret, token))>` (ตรวจจากโค้ดไลบรารี 1.7.4 + พิสูจน์ด้วย negative control แล้ว)
 *      ส่งทั้งชื่อ dev (`better-auth.session_token`) และ prod (`__Secure-…`) ⇒ ไม่ต้องเดาโหมด
 *   4. **ห้ามข้อมูลของผู้ใช้อื่นหลุด**: seed ผู้ใช้ที่ 2 แล้วยืนยันว่ามาร์กเกอร์ของเขาไม่โผล่ในหน้าของผู้ใช้ที่ 1
 *   5. **เก็บกวาดเสมอ** (finally) และยืนยันว่าเหลือ 0 แถวของ seed · ห้ามพิมพ์ secret ลง log
 */
import { createHmac, randomUUID } from 'node:crypto';
import process from 'node:process';

const BASE_URL = (process.env.BASE_URL ?? 'http://127.0.0.1:3600').replace(/\/+$/, '');
const DATABASE_URL_DIRECT = process.env.DATABASE_URL_DIRECT ?? '';
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? '';

if (!DATABASE_URL_DIRECT) fail('ต้องตั้ง DATABASE_URL_DIRECT');
if (!BETTER_AUTH_SECRET) fail('ต้องตั้ง BETTER_AUTH_SECRET');

function fail(message) {
  console.error(`e2e-smoke: ${message}`);
  process.exit(2);
}

/* ------------------------------------------------------------------ DB ---- */

/** ต่อ DB: `pg` ถ้ามี (CI) ไม่งั้น `@neondatabase/serverless` (Neon) — คืน { query, close } หน้าตาเดียวกัน */
async function openDb(url) {
  try {
    const pg = await import('pg');
    const client = new pg.default.Client({ connectionString: url });
    await client.connect();
    return {
      driver: 'pg',
      query: async (text, params = []) => (await client.query(text, params)).rows,
      close: () => client.end(),
    };
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(url);
    return {
      driver: '@neondatabase/serverless',
      // neon คืนอาเรย์แถวตรง ๆ ในบางเวอร์ชัน → รองรับทั้งสองรูปทรง
      query: async (text, params = []) => {
        const result = await sql.query(text, params);
        return Array.isArray(result) ? result : (result?.rows ?? []);
      },
      close: async () => {},
    };
  }
}

/* -------------------------------------------------------------- ค่าที่คาดหวัง ---- */

/** รูปแบบเงินเดียวกับที่แอปใช้ (src/lib/money.ts formatSatang = Intl th-TH currency THB) */
const THB = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' });
const THB_SIGNED = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', signDisplay: 'always' });
const money = (satang) => THB.format(satang / 100);
const moneySigned = (satang) => THB_SIGNED.format(satang / 100);

/* ------------------------------------------------------------------ main ---- */

const stamp = Date.now();
const ids = {
  user: `e2e-user-${stamp}`,
  other: `e2e-user-other-${stamp}`,
  session: `e2e-sess-${stamp}`,
  otherSession: `e2e-sess-other-${stamp}`,
  account: randomUUID(),
  category: randomUUID(),
  incomeCategory: randomUUID(),
  budget: randomUUID(),
  otherAccount: randomUUID(),
  otherCategory: randomUUID(),
};
const token = `e2e-token-${stamp}`;
const marker = `E2E-${stamp}`;
const otherMarker = `E2E-OTHER-${stamp}`;
const email = `e2e-${stamp}@example.com`;
const amounts = { expense: 12_345, income: 67_890, budget: 500_000, otherExpense: 7_777_777 };

const cookieValue = `${token}.${createHmac('sha256', BETTER_AUTH_SECRET).update(token).digest('base64')}`;
const cookieHeader = `better-auth.session_token=${cookieValue}; __Secure-better-auth.session_token=${cookieValue}`;

/**
 * รูปแบบ id ของ "สคริปต์นี้" — ใช้ทั้งตอนกวาดของค้าง (sweep) และตอนยืนยันว่าล้างหมด
 * (ผู้ใช้จริงของแอปเป็น uuid/ข้อความสุ่ม ⇒ ไม่มีทางชนกับ `e2e-`)
 */
const OWNER_LIKE = 'e2e-%';

let cleaning = false;
/** รหัสออกที่มาจากสัญญาณ (130 = SIGINT · 143 = SIGTERM) — ตั้งโดย signal handler เพื่อให้รหัสออกคงที่ */
let signalExit = null;

/** นับแถวทั้งหมดที่ยังค้างอยู่ซึ่งตรงกับรูปแบบของสคริปต์นี้ (ทุกตารางที่ seed) */
async function countOwned() {
  const row = (
    await db.query(
      `select (select count(*) from "user" where id like $1)
            + (select count(*) from "session" where user_id like $1)
            + (select count(*) from account where user_id like $1)
            + (select count(*) from accounts where user_id like $1)
            + (select count(*) from categories where user_id like $1)
            + (select count(*) from transactions where user_id like $1)
            + (select count(*) from budgets where user_id like $1) as n`,
      [OWNER_LIKE],
    )
  )[0];
  return Number(row.n);
}

/**
 * ล้างทุกแถวของสคริปต์นี้ — **ฟังก์ชันเดียวที่ idempotent** เรียกได้ทั้งจาก finally และจาก signal handler
 * ลบ `user` ก่อน (FK เป็น on delete cascade ⇒ session/account/accounts/categories/transactions/budgets ตามไปเอง)
 * แล้วลบแถวลูกที่อาจค้างแบบไม่มีเจ้าของ (กรณี user ถูกลบไปแล้วบางส่วน) — ใช้ `like` ⇒ ครอบของค้างจากรอบที่ตายด้วย
 */
async function cleanupAll(reason) {
  if (cleaning || !db) return;
  cleaning = true;
  const steps = [
    [`delete from "user" where id like $1`, OWNER_LIKE],
    [`delete from accounts where user_id like $1`, OWNER_LIKE],
    [`delete from categories where user_id like $1`, OWNER_LIKE],
    [`delete from transactions where user_id like $1`, OWNER_LIKE],
    [`delete from budgets where user_id like $1`, OWNER_LIKE],
    [`delete from session where user_id like $1`, OWNER_LIKE],
    [`delete from account where user_id like $1`, OWNER_LIKE],
  ];
  for (const [sql, value] of steps) {
    await db.query(sql, [value]).catch((error) => {
      console.error(`cleanup (${reason}) ล้มที่ "${sql}": ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

/** กวาดของค้างจากรอบก่อน (เช่นรอบที่ถูก kill -9) ก่อน seed ใหม่ — คืนจำนวนแถวที่กวาดได้ */
async function sweepOld() {
  const before = await countOwned();
  if (before > 0) await cleanupAll('sweep');
  cleaning = false; // เปิดให้ cleanup รอบจริง (finally/signal) ทำงานต่อได้
  return before;
}

const results = [];
const check = async (name, run) => {
  try {
    const note = await run();
    results.push({ name, ok: true, note: note ?? '' });
  } catch (error) {
    results.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
  }
};

const get = async (path, init = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { cookie: cookieHeader, ...(init.headers ?? {}) },
    redirect: 'manual',
    ...init,
  });
  return { status: response.status, headers: response.headers, body: await response.text() };
};

/** หน้าที่ต้องเป็น 200 + ต้องไม่มีมาร์กเกอร์ของผู้ใช้อื่น (ตัวช่วยกลาง ลดจุดหลุด) */
const page = async (path) => {
  const result = await get(path);
  if (result.status !== 200) throw new Error(`${path} ได้ ${result.status} (ต้องเป็น 200)`);
  if (result.body.includes(otherMarker)) throw new Error(`${path}: พบข้อมูลของผู้ใช้อื่น (${otherMarker})`);
  return result;
};

let db;
try {
  db = await openDb(DATABASE_URL_DIRECT);

  // Ctrl-C / cancel ของ CI: ล้าง seed ก่อนออกเสมอ แล้วค่อยออกด้วยรหัสมาตรฐาน (130 = SIGINT · 143 = SIGTERM)
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    process.on(signal, () => {
      signalExit = code;
      cleanupAll(signal).finally(() => process.exit(code));
    });
  }

  const swept = await sweepOld();
  console.log(`e2e smoke → ${BASE_URL}\nseed ${marker} · driver ${db.driver}${swept > 0 ? ` · กวาดของค้าง ${swept} แถว` : ''}\n`);

  /* ---------------------------------------------------------------- seed ---- */

  await db.query(`insert into "user" (id, name, email, email_verified) values ($1, $2, $3, false)`, [
    ids.user,
    `E2E User ${marker}`,
    email,
  ]);
  await db.query(`insert into "session" (id, expires_at, token, user_id) values ($1, now() + interval '1 day', $2, $3)`, [
    ids.session,
    token,
    ids.user,
  ]);
  await db.query(`insert into accounts (id, user_id, name, kind, initial_balance) values ($1, $2, $3, 'cash', 0)`, [
    ids.account,
    ids.user,
    `กระเป๋า ${marker}`,
  ]);
  await db.query(`insert into categories (id, user_id, kind, name) values ($1, $2, 'expense', $3)`, [
    ids.category,
    ids.user,
    `หมวด ${marker}`,
  ]);
  // หมวดรับแยกจากหมวดจ่าย — DB บังคับ (composite FK + transactions_shape_ck: แถวที่ไม่ใช่โอนต้องมีหมวด)
  await db.query(`insert into categories (id, user_id, kind, name) values ($1, $2, 'income', $3)`, [
    ids.incomeCategory,
    ids.user,
    `หมวดรับ ${marker}`,
  ]);
  await db.query(
    `insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
       ($1, 'expense', $2, $3, $4, now(), $5),
       ($1, 'income',  $2, $6, $7, now(), $8),
       ($1, 'expense', $2, $3, 999, now(), $9)`,
    [
      ids.user,
      ids.account,
      ids.category,
      amounts.expense,
      `รายจ่าย ${marker}`,
      ids.incomeCategory,
      amounts.income,
      `รายรับ ${marker}`,
      `ที่ลบแล้ว ${marker}`,
    ],
  );
  await db.query(`update transactions set deleted_at = now() where user_id = $1 and note = $2`, [ids.user, `ที่ลบแล้ว ${marker}`]);
  // งวดเดือนต้องเป็นวันแรกของเดือนไทย — ให้ DB คิดเอง (กัน timezone ของเครื่อง/ไดรเวอร์เพี้ยน)
  await db.query(
    `insert into budgets (id, user_id, category_id, period_month, amount)
     values ($1, $2, $3, (date_trunc('month', now() at time zone interval '7 hours'))::date, $4)`,
    [ids.budget, ids.user, ids.category, amounts.budget],
  );

  // ผู้ใช้ที่ 2 — ใช้ตรวจว่าไม่มีข้อมูลข้ามบัญชี (ชื่อ/หมวดที่จดจำได้)
  await db.query(`insert into "user" (id, name, email, email_verified) values ($1, $2, $3, false)`, [
    ids.other,
    `E2E Other ${otherMarker}`,
    `e2e-other-${stamp}@example.com`,
  ]);
  await db.query(`insert into "session" (id, expires_at, token, user_id) values ($1, now() + interval '1 day', $2, $3)`, [
    ids.otherSession,
    `e2e-other-token-${stamp}`,
    ids.other,
  ]);
  await db.query(`insert into accounts (id, user_id, name, kind) values ($1, $2, $3, 'bank')`, [
    ids.otherAccount,
    ids.other,
    `กระเป๋าลับ ${otherMarker}`,
  ]);
  await db.query(`insert into categories (id, user_id, kind, name) values ($1, $2, 'expense', $3)`, [
    ids.otherCategory,
    ids.other,
    `หมวดลับ ${otherMarker}`,
  ]);
  await db.query(
    `insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
     values ($1, 'expense', $2, $3, $4, now(), $5)`,
    [ids.other, ids.otherAccount, ids.otherCategory, amounts.otherExpense, `ของคนอื่น ${otherMarker}`],
  );

  /* -------------------------------------------------------------- checks ---- */
  const totals = (
    await db.query(
      `select coalesce(sum(case when kind = 'income' then amount end), 0)::bigint as income,
              coalesce(sum(case when kind = 'expense' then amount end), 0)::bigint as expense
         from transactions
        where user_id = $1 and deleted_at is null
          and occurred_month_bkk = (date_trunc('month', now() at time zone interval '7 hours'))::date`,
      [ids.user],
    )
  )[0];
  const income = Number(totals.income);
  const expense = Number(totals.expense);
  const balance = income - expense;

  await check('/ แสดงยอดเดือนนี้ตรงกับที่คำนวณจาก DB + รายการล่าสุดของเดือนนั้น', async () => {
    const { body } = await page('/');
    for (const [label, expected] of [
      ['คงเหลือ', money(balance)],
      ['รับ', moneySigned(income)],
      ['จ่าย', moneySigned(-expense)],
    ]) {
      if (!body.includes(expected)) throw new Error(`ไม่พบยอด ${label} = ${expected} ในหน้าแรก`);
    }
    // แถวในลิสต์แสดง "ชื่อหมวด" (ไม่ใช่โน้ต) — จึงใช้ชื่อหมวดที่มีมาร์กเกอร์เป็นตัวตรวจ
    if (!body.includes(`หมวด ${marker}`) || !body.includes(`หมวดรับ ${marker}`)) {
      throw new Error('ไม่พบรายการล่าสุดของเดือนนี้ (ชื่อหมวดของรายการที่ seed)');
    }
    return `คงเหลือ ${money(balance)}`;
  });

  await check('/transactions แสดงรายการที่ไม่ถูกลบ และไม่แสดงรายการที่ลบแล้ว', async () => {
    const { body } = await page('/transactions?m=all');
    // รายจ่าย+รายรับที่ยังไม่ถูกลบ ต้องเห็นทั้งคู่ (รายจ่ายใช้หมวด E2E · รายรับใช้หมวดรับ E2E)
    for (const label of [`หมวด ${marker}`, `หมวดรับ ${marker}`]) {
      if (!body.includes(label)) throw new Error(`ไม่พบ ${label}`);
    }
    // แถวที่ลบแล้ว (ยอด ฿9.99) ต้องไม่โผล่ในหน้ารายการ
    if (body.includes(money(999))) throw new Error('รายการที่ลบแล้วต้องไม่โผล่ในหน้ารายการ');
    return 'ครบ 2 แถว · ไม่มีแถวที่ลบ';
  });

  await check('/summary แสดงงบของเดือนนี้ (หมวด + จำนวน)', async () => {
    const { body } = await page('/summary');
    if (!body.includes(`หมวด ${marker}`)) throw new Error('ไม่พบชื่อหมวดของงบในหน้าสรุป');
    if (!body.includes(money(amounts.budget))) throw new Error(`ไม่พบจำนวนงบ ${money(amounts.budget)}`);
    return `งบ ${money(amounts.budget)}`;
  });

  await check('/settings แสดงอีเมลที่ตั้งไว้', async () => {
    const { body } = await page('/settings');
    if (!body.includes(email)) throw new Error(`ไม่พบอีเมล ${email} ในหน้าตั้งค่า`);
    return email;
  });

  await check('/settings/trash แสดงรายการที่ลบแล้ว (กู้คืนได้)', async () => {
    const { body } = await page('/settings/trash');
    // ถังขยะแสดงชื่อหมวด + ยอดของรายการที่ลบ (ยอด 999 สตางค์ = ฿9.99 ใช้เป็นมาร์กเกอร์ที่ไม่ชนของใคร)
    if (!body.includes(`หมวด ${marker}`)) throw new Error('ไม่พบชื่อหมวดของรายการที่ลบแล้ว');
    if (!body.includes(money(999))) throw new Error(`ไม่พบยอดของรายการที่ลบแล้ว (${money(999)})`);
    return 'พบ 1 รายการ';
  });

  await check('/export/transactions เป็น CSV + จำนวนบรรทัด = รายการที่ไม่ถูกลบ + หัวตาราง', async () => {
    const { status, headers, body } = await get('/export/transactions');
    if (status !== 200) throw new Error(`ได้ ${status}`);
    const type = headers.get('content-type') ?? '';
    if (!type.includes('text/csv')) throw new Error(`content-type = "${type}" (ต้องเป็น text/csv)`);
    if (body.includes(otherMarker)) throw new Error('ไฟล์ส่งออกมีข้อมูลของผู้ใช้อื่น');

    const live = Number((await db.query(`select count(*)::int as n from transactions where user_id = $1 and deleted_at is null`, [ids.user]))[0].n);
    const lines = body.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    if (lines.length !== live + 1) throw new Error(`ได้ ${lines.length} บรรทัด (คาด ${live + 1} = ${live} แถว + หัวตาราง)`);
    if (!lines[0].startsWith('id,occurred_at,occurred_month')) throw new Error('หัวตารางไม่ตรงสเปก');
    if (!body.includes(`รายจ่าย ${marker}`)) throw new Error('ไม่พบรายการของเราในไฟล์');
    return `${live} แถว + หัวตาราง · ${type.split(';')[0]}`;
  });

  /**
   * ค่าที่ "คำนวณจาก DB" ของ *ทั้งสองผู้ใช้* — ถ้ามีการรั่ว (เช่น query ลืมกรอง userId)
   * หน้าที่เรนเดอร์จะโชว์ตัวเลขชุดนี้ ซึ่งต้องไม่ปรากฏในหน้าของผู้ใช้ที่ 1
   */
  const leakTotals = (
    await db.query(
      `select coalesce(sum(case when kind = 'income' then amount end), 0)::bigint as income,
              coalesce(sum(case when kind = 'expense' then amount end), 0)::bigint as expense
         from transactions
        where deleted_at is null
          and occurred_month_bkk = (date_trunc('month', now() at time zone interval '7 hours'))::date
          and user_id like $1`,
      [OWNER_LIKE],
    )
  )[0];
  const leakIncome = Number(leakTotals.income);
  const leakExpense = Number(leakTotals.expense);
  const otherLiveRows = Number(
    (await db.query(`select count(*)::int as n from transactions where user_id = $1 and deleted_at is null`, [ids.other]))[0].n,
  );
  const myLiveRows = Number(
    (await db.query(`select count(*)::int as n from transactions where user_id = $1 and deleted_at is null`, [ids.user]))[0].n,
  );

  await check('ไม่มีข้อมูลของผู้ใช้อื่นในทุกหน้าที่ตรวจ (มาร์กเกอร์ + ยอดจาก DB + จำนวนแถวที่เรนเดอร์)', async () => {
    const paths = ['/', '/transactions?m=all', '/summary', '/settings', '/settings/trash'];
    /**
     * ตัวเลขที่ "รวมข้อมูลของผู้ใช้อื่น" — ห้ามโผล่ในหน้าของผู้ใช้ที่ 1 (ตรวจอิสระจากการตรวจยอดด้านบน)
     * ตัดตัวที่ "บังเอิญเท่ากับยอดจริงของผู้ใช้เรา" ออกก่อน (เช่นผู้ใช้อื่นมีแต่รายจ่าย ⇒ ยอดรับรวมเท่าเดิม)
     * แล้วบังคับว่าต้องเหลืออย่างน้อย 1 ตัว ไม่งั้นการตรวจจะกลายเป็น vacuous (ผ่านทุกกรณี)
     */
    const mine = new Set([money(balance), moneySigned(income), moneySigned(-expense)]);
    const forbidden = [
      ['ยอดคงเหลือรวมทั้งสองผู้ใช้', money(leakIncome - leakExpense)],
      ['ยอดรับรวมทั้งสองผู้ใช้', moneySigned(leakIncome)],
      ['ยอดจ่ายรวมทั้งสองผู้ใช้', moneySigned(-leakExpense)],
      ['ยอดของรายการผู้ใช้อื่น', money(amounts.otherExpense)],
      ['ยอดของรายการผู้ใช้อื่น (แบบมีเครื่องหมาย)', moneySigned(-amounts.otherExpense)],
    ].filter(([, value]) => !mine.has(value));
    if (forbidden.length === 0) throw new Error('ตัวตรวจการรั่วไม่มีค่าที่ต่างจากยอดจริง — ตั้งค่าผู้ใช้อื่นให้ต่างจากผู้ใช้เรา');
    for (const path of paths) {
      const { body } = await get(path);
      if (body.includes(otherMarker)) throw new Error(`${path}: พบมาร์กเกอร์ของผู้ใช้อื่น (${otherMarker})`);
      if (body.includes('e2e-other-')) throw new Error(`${path}: พบอีเมลของผู้ใช้อื่น`);
      for (const [label, value] of forbidden) {
        if (body.includes(value)) throw new Error(`${path}: พบ ${label} = ${value} (ข้อมูลของผู้ใช้อื่นหลุด)`);
      }
    }

    // จำนวนแถวที่ /transactions เรนเดอร์จริง ต้องเท่ากับจำนวนที่ DB บอกว่าผู้ใช้คนนี้ "ยังไม่ลบ"
    const { body: listBody } = await get('/transactions?m=all');
    const rendered = [...listBody.matchAll(/aria-label="แก้รายการ /g)].length;
    if (rendered !== myLiveRows) {
      throw new Error(`/transactions เรนเดอร์ ${rendered} แถว แต่ DB ของผู้ใช้เรามี ${myLiveRows} แถว`);
    }
    if (rendered === myLiveRows + otherLiveRows) {
      throw new Error('/transactions เรนเดอร์รวมแถวของผู้ใช้อื่นด้วย');
    }
    return `${paths.length} หน้า สะอาด · ${rendered} แถวตรงกับ DB`;
  });
} catch (error) {
  results.push({ name: 'seed/รันระบบ', ok: false, note: error instanceof Error ? error.message : String(error) });
} finally {
  /* ------------------------------------------------------------- cleanup ---- */
  if (db) {
    await cleanupAll('finally');
    const left = await countOwned(); // นับตาม "รูปแบบของสคริปต์" ⇒ ครอบของค้างจากรอบก่อนด้วย
    results.push({ name: 'cleanup: ล้างข้อมูลของสคริปต์หมด', ok: left === 0, note: `เหลือ ${left} แถว` });
    await db.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\ne2e smoke → ${BASE_URL}\n`);
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.note ? ` — ${result.note}` : ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} ผ่าน${failed ? ` · ไม่ผ่าน ${failed} ข้อ` : ''}`);
  // ถ้าถูกสัญญาณ (Ctrl-C/cancel) ให้รหัสออกสื่อเรื่องนั้น (130/143) ไม่ใช่ 1 จากผลการตรวจที่ถูกตัดกลางทาง
  process.exit(signalExit ?? (failed === 0 ? 0 : 1));
}
