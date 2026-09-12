#!/usr/bin/env node
// schema_check.mjs — ตรวจ docs/schema.sql ว่า "รันได้จริงและกันของเสียได้จริง"
//
// ใช้ (จากรากโปรเจกต์, ไม่ต้องตั้ง env อะไร):
//   node docs/tools/schema_check.mjs                      # ตรวจ docs/schema.sql (ค่าเริ่มต้น)
//   node docs/tools/schema_check.mjs path/อื่น.sql        # ตรวจไฟล์อื่น (เช่น สำเนาที่กำลังแก้)
//   node docs/tools/schema_check.mjs --selftest           # พิสูจน์ว่าตัวตรวจเองจับ schema ที่พังได้
//   node docs/tools/schema_check.mjs --help
//
// ขอบเขตที่ตรวจ (5 กลุ่ม)
//   1. apply DDL ลง Postgres จริง — syntax + semantic (FK อ้าง unique ที่มีจริง, check ที่ PG รับ, generated column)
//   2. constraint: กันข้ามผู้ใช้ · หมวด kind ไม่ตรง · รูปแบบ transfer · amount 0/ลบ/เกินเพดาน · currency ไม่ใช่ THB
//      · ชื่อว่าง · email ไม่ normalize · ชื่อซ้ำ (partial unique) · งบเดือนไม่ใช่วันที่ 1 · FK ข้ามตาราง
//   3. generated column: occurred_month_bkk ต้องตรงกับวิธีคิดช่วงเวลา +07 และเขียนค่าลงตรง ๆ ไม่ได้
//   4. FK: RI-style query ของ FK ต้องใช้ index ได้ (ไม่ใช่ Seq Scan) — พิสูจน์ว่า index ที่ถอด partial ไว้ทำหน้าที่
//   5. index: query จริงของหน้าแรก/หน้าสรุป/เทียบงบ EXPLAIN แล้วต้องไม่เป็น Seq Scan ทั้งตาราง
//      (ยอดเงิน: transfer ต้องไม่ปนยอดรับ/จ่าย · soft delete ต้องหลุดจากยอดแต่แถวยังอยู่ · updated_at trigger ต้องทำงาน)
//
// เอนจิน: @electric-sql/pglite = PostgreSQL จริง compiled to WASM (ไม่ใช่ mock) — สคริปต์พิมพ์เวอร์ชันจริงทุกครั้งที่รัน
// ไม่ต้องมี server/psql/docker และไม่แตะข้อมูลจริงที่ไหน · ไฟล์นี้ไม่พึ่ง path ชั่วคราวใด ๆ (รับ path เป็น argument หรือใช้ค่าเริ่มต้นในรีโป)
//
// ผ่านเมื่อ: ไม่มีบรรทัด FAIL และ exit 0 · มี FAIL = exit 1
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const DEFAULT_SCHEMA = fileURLToPath(new URL('../../docs/schema.sql', import.meta.url));
const PGLITE_VERSION = JSON.parse(
  readFileSync(new URL('../../node_modules/@electric-sql/pglite/package.json', import.meta.url), 'utf8')
).version;

const A1 = '00000000-0000-0000-0000-0000000000a1';
const A2 = '00000000-0000-0000-0000-0000000000a2';
const B1 = '00000000-0000-0000-0000-0000000000b1';
const C1 = '00000000-0000-0000-0000-0000000000c1';
const C2 = '00000000-0000-0000-0000-0000000000c2';
const D1 = '00000000-0000-0000-0000-0000000000d1';

const d10 = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function usage() {
  console.log(`schema_check.mjs — ตรวจ schema.sql ว่า apply ได้และกันของเสียได้จริง

ใช้:
  node docs/tools/schema_check.mjs [ไฟล์.sql]     ตรวจไฟล์ (ค่าเริ่มต้น docs/schema.sql)
  node docs/tools/schema_check.mjs --selftest     พิสูจน์ว่าตัวตรวจจับ schema ที่พังได้จริง
  node docs/tools/schema_check.mjs --help

ออก: 0 = ผ่านทั้งหมด · 1 = มี FAIL หรือ selftest ไม่ผ่าน · 2 = ใช้ argument ผิด
ไม่ต้องตั้ง env · ใช้ Postgres จริงผ่าน PGlite (WASM) · ไม่มี server/docker/psql ให้ตั้ง`);
}

// แกนการตรวจทั้งหมด — คืนผลเป็นข้อมูล (ให้ --selftest เรียกซ้ำได้)
async function run(sql, { quiet = false } = {}) {
  const db = new PGlite();
  const failures = [];
  let pass = 0;
  const say = (l) => { if (!quiet) console.log(l); };
  const ok = (m) => { pass++; say('  ok    ' + m); };
  const bad = (m, e) => { failures.push(m); say('  FAIL  ' + m + ' -> ' + String(e).split('\n')[0].slice(0, 200)); };
  const eq = (m, got, want) => String(got) === String(want) ? ok(`${m} = ${got}`) : bad(m, `got ${got}, want ${want}`);
  async function mustFail(m, q, code) {
    try { await db.query(q); bad(m, 'no error raised'); }
    catch (e) { if (code && e.code !== code) bad(m + ' (want ' + code + ')', e); else ok(m + ' [' + e.code + ']'); }
  }

  try {
    say('== 0. เอนจิน');
    const ver = (await db.query('select version() as v')).rows[0].v;
    say('     ' + norm(ver).split(' ').slice(0, 2).join(' ') + ' ผ่าน @electric-sql/pglite ' + PGLITE_VERSION);

    say('== 1. apply DDL ลง Postgres จริง');
    await db.exec(sql);
    const tables = (await db.query(`select table_name from information_schema.tables where table_schema='public' order by 1`)).rows;
    ok('สร้างตาราง: ' + tables.map(t => t.table_name).join(', '));

    say('== 2. seed ข้อมูลจริง (ทุกแบบที่แอปจะเขียน)');
    await db.query(`insert into "user" (id,name,email) values
      ('u1','สมชาย','a@x.com'),('u2','สมหญิง','b@x.com'),('u3','LINE ไม่มีอีเมล',null),('u4','LINE 2',null)`);
    ok('4 ผู้ใช้ (2 คนไม่มีอีเมล = ผู้ใช้ LINE ที่ยังไม่ได้สิทธิ์ email)');
    await db.query(`insert into accounts (id,user_id,name,kind,initial_balance) values
      ('${A1}','u1','เงินสด','cash',50000),('${A2}','u1','ธนาคาร','bank',100000),('${B1}','u2','เงินสด','cash',0)`);
    ok('กระเป๋า (ชื่อซ้ำข้ามผู้ใช้ได้)');
    await db.query(`insert into categories (id,user_id,kind,name) values
      ('${C1}','u1','expense','อาหาร'),('${C2}','u1','income','เงินเดือน'),('${D1}','u2','expense','อาหาร')`);
    ok('หมวดต่อผู้ใช้');
    await db.query(`insert into transactions (user_id,kind,account_id,category_id,amount,occurred_at) values
      ('u1','expense','${A1}','${C1}',19900,'2026-09-10T12:00:00+07'),
      ('u1','income','${A2}','${C2}',5000000,'2026-09-01T09:00:00+07')`);
    await db.query(`insert into transactions (user_id,kind,account_id,to_account_id,amount,occurred_at) values
      ('u1','transfer','${A1}','${A2}',100000,'2026-09-11T12:00:00+07')`);
    // 00:30 วันที่ 1 ตามเวลาไทย = 31 ส.ค. 17:30 UTC → ต้องนับเป็นเดือน ก.ย. เท่านั้น
    await db.query(`insert into transactions (user_id,kind,account_id,category_id,amount,occurred_at) values
      ('u1','expense','${A1}','${C1}',5000,'2026-09-01T00:30:00+07')`);
    await db.query(`insert into budgets (user_id,category_id,period_month,amount) values ('u1','${C1}','2026-09-01',300000)`);
    ok('รายการ รับ/จ่าย/โอน + 1 แถวข้ามเส้นเดือน UTC + งบ');

    say('== 3. constraint ต้องปฏิเสธของเสีย');
    await mustFail('จ่ายโดยใช้หมวดของผู้ใช้อื่น', `insert into transactions (user_id,kind,account_id,category_id,amount) values ('u1','expense','${A1}','${D1}',100)`, '23503');
    await mustFail('จ่ายโดยใช้หมวด kind=income', `insert into transactions (user_id,kind,account_id,category_id,amount) values ('u1','expense','${A1}','${C2}',100)`, '23503');
    await mustFail('จ่ายโดยใช้กระเป๋าของผู้ใช้อื่น', `insert into transactions (user_id,kind,account_id,category_id,amount) values ('u1','expense','${B1}','${C1}',100)`, '23503');
    await mustFail('งบผูกหมวดของผู้ใช้อื่น', `insert into budgets (user_id,category_id,period_month,amount) values ('u1','${D1}','2026-08-01',100)`, '23503');
    await mustFail('จ่ายที่มี to_account_id', `insert into transactions (user_id,kind,account_id,to_account_id,category_id,amount) values ('u1','expense','${A1}','${A2}','${C1}',100)`, '23514');
    await mustFail('จ่ายที่ไม่มีหมวด', `insert into transactions (user_id,kind,account_id,amount) values ('u1','expense','${A1}',100)`, '23514');
    await mustFail('โอนที่มีหมวด', `insert into transactions (user_id,kind,account_id,to_account_id,category_id,amount) values ('u1','transfer','${A1}','${A2}','${C1}',100)`, '23514');
    await mustFail('โอนที่ไม่มีปลายทาง', `insert into transactions (user_id,kind,account_id,amount) values ('u1','transfer','${A1}',100)`, '23514');
    await mustFail('โอนเข้าบัญชีตัวเอง', `insert into transactions (user_id,kind,account_id,to_account_id,amount) values ('u1','transfer','${A1}','${A1}',100)`, '23514');
    await mustFail('amount = 0', `insert into transactions (user_id,kind,account_id,category_id,amount) values ('u1','expense','${A1}','${C1}',0)`, '23514');
    await mustFail('amount ติดลบ', `insert into transactions (user_id,kind,account_id,category_id,amount) values ('u1','expense','${A1}','${C1}',-500)`, '23514');
    await mustFail('amount เกิน safe integer', `insert into transactions (user_id,kind,account_id,category_id,amount) values ('u1','expense','${A1}','${C1}',1000000000000000)`, '23514');
    await mustFail('kind ที่ไม่รู้จัก', `insert into transactions (user_id,kind,account_id,category_id,amount) values ('u1','refund','${A1}','${C1}',100)`, '23514');
    await mustFail('accounts currency = USD', `insert into accounts (user_id,name,currency) values ('u1','ทดสอบ','USD')`, '23514');
    await mustFail('transactions currency = USD', `insert into transactions (user_id,kind,account_id,category_id,amount,currency) values ('u1','expense','${A2}','${C1}',100,'USD')`, '23514');
    await mustFail('budgets currency = USD', `insert into budgets (user_id,category_id,period_month,amount,currency) values ('u1','${C1}','2026-07-01',100,'USD')`, '23514');
    await mustFail('email ตัวพิมพ์ใหญ่', `insert into "user" (id,name,email) values ('u6','x','YORU@X.COM')`, '23514');
    await mustFail('email มีช่องว่างหัวท้าย', `insert into "user" (id,name,email) values ('u7','x',' yoru@x.com ')`, '23514');
    await mustFail('ชื่อกระเป๋าว่าง', `insert into accounts (user_id,name) values ('u1','')`, '23514');
    await mustFail('ชื่อกระเป๋าเป็นช่องว่างล้วน', `insert into accounts (user_id,name) values ('u1','   ')`, '23514');
    await mustFail('ชื่อหมวดว่าง', `insert into categories (user_id,kind,name) values ('u1','expense','')`, '23514');
    await mustFail('initial_balance = 1e15', `insert into accounts (user_id,name,initial_balance) values ('u1','เกินบวก',1000000000000000)`, '23514');
    await mustFail('initial_balance = -1e15', `insert into accounts (user_id,name,initial_balance) values ('u1','เกินลบ',-1000000000000000)`, '23514');
    await mustFail('ชื่อกระเป๋าซ้ำ (ต่างช่องว่าง)', `insert into accounts (user_id,name) values ('u1',' เงินสด ')`, '23505');
    await mustFail('ชื่อหมวดซ้ำ kind เดียวกัน', `insert into categories (user_id,kind,name) values ('u1','expense','อาหาร')`, '23505');
    await mustFail('งบเดือนไม่ใช่วันที่ 1', `insert into budgets (user_id,category_id,period_month,amount) values ('u1','${C1}','2026-08-15',100)`, '23514');
    await mustFail('session ของผู้ใช้ที่ไม่มี', `insert into session (id,expires_at,token,user_id) values ('s1',now()+interval '1 day','t1','nope')`, '23503');
    await mustFail('รายการของผู้ใช้ที่ไม่มี', `insert into transactions (user_id,kind,account_id,category_id,amount) values ('nope','expense','${A1}','${C1}',100)`, '23503');
    await mustFail('email ซ้ำ', `insert into "user" (id,name,email) values ('u5','x','a@x.com')`, '23505');
    const negBal = (await db.query(`insert into accounts (user_id,name,initial_balance) values ('u1','บัตรเครดิต',-500000) returning initial_balance::bigint as b`)).rows[0];
    eq('initial_balance ติดลบได้ (บัตรเครดิต)', negBal.b, -500000);
    ok('ผู้ใช้ที่ email เป็น null หลายคนอยู่ร่วมกันได้ (u3, u4)');

    say('== 4. คณิตศาสตร์ยอดเงิน');
    const totals = (await db.query(`select kind, sum(amount)::bigint as s from transactions
      where user_id='u1' and deleted_at is null group by kind order by kind`)).rows;
    eq('ยอดจ่ายรวม', totals.find(x => x.kind === 'expense').s, 24900);
    eq('ยอดรับรวม', totals.find(x => x.kind === 'income').s, 5000000);
    eq('ยอดโอน (แยกจากรับ/จ่าย)', totals.find(x => x.kind === 'transfer').s, 100000);
    eq('คงเหลือเดือน (รับ - จ่าย)',
      Number(totals.find(x => x.kind === 'income').s) - Number(totals.find(x => x.kind === 'expense').s), 4975100);

    say('== 5. งวดเดือนไทย (generated column)');
    await db.query(`set timezone='UTC'`);
    const utcBucket = (await db.query(`select date_trunc('month', occurred_at)::date as d from transactions where amount = 5000`)).rows[0].d;
    eq('ตัดเดือนด้วย session=UTC (ผิด ถ้าไม่ตรึง)', d10(utcBucket), '2026-08-01');
    const bkkRow = (await db.query(`select occurred_month_bkk as m from transactions where occurred_at = '2026-09-01T00:30:00+07'::timestamptz`)).rows[0];
    eq('occurred_month_bkk ของ 00:30+07 วันที่ 1', d10(bkkRow.m), '2026-09-01');
    const eqTotals = (await db.query(`select coalesce(sum(amount),0)::bigint as s from transactions
      where user_id='u1' and kind='expense' and deleted_at is null and occurred_month_bkk = date '2026-09-01'`)).rows[0];
    const rangeTotals = (await db.query(`select coalesce(sum(amount),0)::bigint as s from transactions
      where user_id='u1' and kind='expense' and deleted_at is null
        and occurred_at >= '2026-09-01T00:00:00+07' and occurred_at < '2026-10-01T00:00:00+07'`)).rows[0];
    eq('ยอดจ่าย ก.ย. ด้วย equality = วิธีคิดช่วงเวลา +07', eqTotals.s, rangeTotals.s);
    await mustFail('เขียนค่าลง generated column ตรง ๆ', `insert into transactions (user_id,kind,account_id,category_id,amount,occurred_month_bkk) values ('u1','expense','${A2}','${C1}',100,date '2026-09-01')`, '428C9');

    say('== 6. soft delete + trigger');
    await db.query(`update transactions set deleted_at = now() where amount = 5000`);
    const after = (await db.query(`select coalesce(sum(amount),0)::bigint as s from transactions
      where user_id='u1' and kind='expense' and deleted_at is null`)).rows[0];
    eq('ยอดจ่ายหลัง soft delete', after.s, 19900);
    eq('จำนวนแถวทั้งหมด (ยังอยู่ครบ)', (await db.query(`select count(*)::int as n from transactions where user_id='u1'`)).rows[0].n, 4);
    await db.query(`update accounts set archived_at=now() where id='${A1}'`);
    await db.query(`insert into accounts (user_id,name) values ('u1','เงินสด')`);
    ok('archive แล้วสร้างชื่อเดิมได้');
    const bumped = (await db.query(`update transactions set note='แก้โน้ต' where kind='expense' and deleted_at is null returning updated_at > created_at as b`)).rows[0];
    if (bumped.b) ok('trigger updated_at ทำงานตอน update');
    else bad('trigger updated_at ทำงานตอน update', 'updated_at ไม่ขยับ');

    say('== 7. index ที่ query จริงต้องได้ใช้');
    // แผน index บนตาราง 4 แถวไม่มีความหมาย → ใส่ข้อมูลก้อนใหญ่ + analyze ก่อน EXPLAIN
    await db.query(`insert into transactions (user_id,kind,account_id,category_id,amount,occurred_at)
      select 'u1','expense','${A2}','${C1}', 1000 + (g % 90) * 100, timestamptz '2024-01-01 00:00+07' + (g * interval '6 hours')
      from generate_series(1,1500) g`);
    await db.query(`insert into categories (id,user_id,kind,name) values ('00000000-0000-0000-0000-0000000000d2','u2','expense','อื่น ๆ')`);
    await db.query(`insert into transactions (user_id,kind,account_id,category_id,amount,occurred_at)
      select 'u2','expense','${B1}','00000000-0000-0000-0000-0000000000d2', 1000, timestamptz '2024-01-01 00:00+07' + (g * interval '3 hours')
      from generate_series(1,3000) g`);
    await db.query(`insert into transactions (user_id,kind,account_id,category_id,amount,occurred_at)
      select 'u1','expense','${A2}','${C1}', 500, timestamptz '2026-09-01 00:00+07' + (g * interval '1 hour')
      from generate_series(1,400) g`);
    await db.query('vacuum analyze');
    ok('ทดสอบบน ' + (await db.query(`select count(*)::int as n from transactions`)).rows[0].n + ' แถว + analyze แล้ว');

    const cases = [
      ['หน้าแรก รายการล่าสุด', `select id from transactions where user_id='u1' and deleted_at is null order by occurred_at desc, id desc limit 20`, ['transactions_user_recent_idx']],
      ['ยอดเดือนนี้แยก kind', `select kind, sum(amount) from transactions where user_id='u1' and deleted_at is null and kind in ('income','expense') and occurred_at >= '2026-09-01T00:00:00+07' and occurred_at < '2026-10-01T00:00:00+07' group by kind`, ['transactions_user_kind_time_idx', 'transactions_user_recent_idx']],
      ['สรุปตามหมวด (เดือนเดียว = query จริง)', `select category_id, sum(amount) from transactions where user_id='u1' and kind='expense' and deleted_at is null and occurred_month_bkk = date '2026-09-01' group by category_id`, ['transactions_user_month_idx', 'transactions_user_category_time_idx']],
      ['สรุปตามหมวด (ทุกช่วง)', `select category_id, sum(amount) from transactions where user_id='u1' and kind='expense' and deleted_at is null group by category_id`, null],
      ['ยอดคงเหลือต่อกระเป๋า', `select account_id, sum(amount) from transactions where user_id='u1' and deleted_at is null group by account_id`, null],
    ];
    await db.query('set enable_seqscan=off');
    for (const [label, q, want] of cases) {
      const plan = (await db.query('explain ' + q)).rows.map(r => r['QUERY PLAN']).join('\n');
      const used = (plan.match(/using ([a-z_]+)/) || [null, 'Index Scan'])[1];
      if (want) {
        const hit = want.find(w => plan.includes(w));
        if (hit) ok(label + ' -> ' + hit);
        else bad(label + ' (ต้องได้ ' + want.join(' หรือ ') + ')', plan.replace(/\n+/g, ' | '));
      } else {
        if (!plan.includes('Seq Scan')) ok(label + ' -> ' + used);
        else bad(label, plan.replace(/\n+/g, ' | '));
      }
    }

    say('== 8. FK ต้องใช้ index ได้ (ถอด partial predicate ไว้ถูกต้อง)');
    for (const [label, q] of [
      ['FK account_id (RI query ไม่มี deleted_at)', `select 1 from transactions x where account_id = '${A2}' and user_id = 'u1' for key share of x`],
      ['FK to_account_id (RI query ไม่มี deleted_at)', `select 1 from transactions x where to_account_id = '${A2}' and user_id = 'u1' for key share of x`],
    ]) {
      const plan = (await db.query('explain ' + q)).rows.map(x => x['QUERY PLAN']).join('\n');
      const hasIdx = plan.includes('transactions_account_idx') || plan.includes('transactions_to_account_idx');
      const seqBlocked = plan.includes('Seq Scan') && plan.includes('Disabled: true');
      if (hasIdx && !seqBlocked) ok(label + ' ใช้ index ได้');
      else bad(label, plan.replace(/\n+/g, ' | '));
    }

    await db.close();
    return { pass, fail: failures.length, failures };
  } catch (e) {
    await db.close().catch(() => {});
    failures.push('harness: ' + String(e).split('\n')[0]);
    return { pass, fail: failures.length, failures };
  }
}

// -------- argument handling --------
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { usage(); process.exit(0); }

if (argv.includes('--selftest')) {
  const sql = readFileSync(argv.find(a => !a.startsWith('-')) ?? DEFAULT_SCHEMA, 'utf8');
  // ทำให้ schema พังแบบตั้งใจ: ถอด check currency ทั้ง 3 ตัว + ถอด create trigger 4 ตัว
  const broken = sql.replaceAll(` check (currency = 'THB')`, '').split('\n').filter(l => !/^\s*create trigger /i.test(l)).join('\n');
  if (broken === sql) { console.log('selftest ใช้ไม่ได้: หา check currency / create trigger ในไฟล์ไม่เจอ (schema เปลี่ยนรูปไปแล้ว?)'); process.exit(1); }
  const r = await run(broken, { quiet: true });
  const currencyCaught = ['accounts currency = USD', 'transactions currency = USD', 'budgets currency = USD'].every(m => r.failures.includes(m));
  const triggerCaught = r.failures.includes('trigger updated_at ทำงานตอน update');
  console.log(`selftest: ถอด check currency 3 ตัว + trigger 4 ตัวออก แล้วตัวตรวจรายงาน ${r.fail} ข้อ`);
  console.log(`  จับ currency ได้ ${currencyCaught ? 'ok' : 'FAIL'} · จับ trigger ที่หายได้ ${triggerCaught ? 'ok' : 'FAIL'}`);
  const pass = currencyCaught && triggerCaught;
  console.log(pass ? 'selftest ผ่าน — ตัวตรวจเชื่อได้' : 'selftest ไม่ผ่าน — ห้ามใช้ตัวตรวจนี้ตัดสินงานจริง');
  process.exit(pass ? 0 : 1);
}

const schemaPath = argv.find(a => !a.startsWith('-')) ?? DEFAULT_SCHEMA;
const sql = readFileSync(schemaPath, 'utf8');
console.log(`ตรวจ: ${schemaPath}\n`);
const r = await run(sql);
console.log(`\npass ${r.pass} · fail ${r.fail}`);
process.exit(r.fail ? 1 : 0);
