/**
 * เทสต์ชั้นข้อมูลของ "ส่งออกข้อมูล" (CSV รายการ + JSON สำรอง) บน PGlite — apply DDL จาก docs/schema.sql ตรง ๆ
 * รัน: node --test src/db/queries/export.test.ts
 *
 * กติกาที่คุมด้วยชุดนี้:
 *   - join ชื่อกระเป๋า/ปลายทาง/หมวดใน query เดียว (ห้าม N+1 — นับ query จริงด้วย Proxy)
 *   - ของผู้ใช้คนอื่นไม่หลุด · รายการที่ลบแล้วไม่ออกไฟล์ (แต่ถูกนับใน counts.excludedDeleted)
 *   - กระเป๋า/หมวดที่ archive แล้วยังออกชื่อได้ (รายการเก่าอ้างถึง)
 *   - keyset ไล่หน้าได้ครบ ไม่ซ้ำ ไม่หาย แม้ occurred_at เท่ากัน
 *   - เพดาน 20,000 → ValidationError ข้อความไทย (ไม่คืนไฟล์ครึ่งเดียว)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { ValidationError } from '../errors.ts';
import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import { toCsv } from '../../lib/export-format.ts';
import {
  MAX_EXPORT_ROWS,
  assertExportWithinCap,
  buildBackupSnapshot,
  countExportRows,
  exportTransactionRows,
} from './export.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'u1';
const U2 = 'u2';
const A1 = '11111111-1111-1111-1111-111111111111';
const A2 = '22222222-2222-2222-2222-222222222222';
const A_OLD = '33333333-3333-3333-3333-333333333333';
const A_U2 = '44444444-4444-4444-4444-444444444444';
const C1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const C2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const C_OLD = 'aaaaaaaa-0000-0000-0000-000000000003';
const C_U2 = 'aaaaaaaa-0000-0000-0000-000000000004';

/** id ของรายการในเทสต์ (คอลัมน์เป็น uuid จึงต้องเป็น uuid จริง) — T(1) = รายการแรก */
const T = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
/** id ของงบในเทสต์ */
const B = (n: number) => `00000000-0000-0000-0001-${String(n).padStart(12, '0')}`;

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`
  insert into "user" (id, name) values ('${U1}', 'Yoru'), ('${U2}', 'Big');

  insert into accounts (id, user_id, name, kind, initial_balance, archived_at) values
    ('${A1}', '${U1}', 'เงินสด', 'cash', 100000, null),
    ('${A2}', '${U1}', 'ธนาคาร', 'bank', 0, null),
    ('${A_OLD}', '${U1}', 'กระเป๋าเก่า', 'cash', 0, now()),
    ('${A_U2}', '${U2}', 'ของอีกคน', 'cash', 0, null);

  insert into categories (id, user_id, kind, name, archived_at) values
    ('${C1}', '${U1}', 'expense', 'อาหาร, เครื่องดื่ม', null),
    ('${C2}', '${U1}', 'income', 'โบนัส"พิเศษ"', null),
    ('${C_OLD}', '${U1}', 'expense', 'หมวดเก่า', now()),
    ('${C_U2}', '${U2}', 'expense', 'ของอีกคน', null);

  -- รายการ: ปกติ · โอน (มีปลายทาง) · กระเป๋า/หมวดที่ archive แล้ว · ลบแล้ว · ของผู้ใช้คนอื่น · เวลาเท่ากัน 3 แถว
  insert into transactions (id, user_id, kind, account_id, to_account_id, category_id, amount, occurred_at, note) values
    ('${T(1)}', '${U1}', 'expense', '${A1}', null, '${C1}', 25000, '2026-09-14T10:30:00Z', E'ซื้อ "กาแฟ"\\nแล้วต่อด้วยข้าว 🍰'),
    ('${T(2)}', '${U1}', 'income',  '${A2}', null, '${C2}', 123456, '2026-09-13T23:00:00Z', 'เงินเดือน'),
    ('${T(3)}', '${U1}', 'transfer','${A1}', '${A2}', null, 50000, '2026-09-12T01:00:00Z', null),
    ('${T(4)}', '${U1}', 'expense', '${A_OLD}', null, '${C_OLD}', 5000, '2026-08-31T17:30:00Z', 'ของเก่า'),
    ('${T(5)}', '${U1}', 'expense', '${A1}', null, '${C1}', 9999, '2026-09-14T09:00:00Z', 'ลบแล้ว'),
    ('${T(6)}', '${U2}', 'expense', '${A_U2}', null, '${C_U2}', 7777, '2026-09-14T09:00:00Z', 'ของอีกคน'),
    ('${T(7)}', '${U1}', 'expense', '${A1}', null, '${C1}', 100, '2026-09-10T04:00:00Z', 'เวลาเท่ากัน 1'),
    ('${T(8)}', '${U1}', 'expense', '${A1}', null, '${C1}', 200, '2026-09-10T04:00:00Z', 'เวลาเท่ากัน 2'),
    ('${T(9)}', '${U1}', 'expense', '${A1}', null, '${C1}', 300, '2026-09-10T04:00:00Z', 'เวลาเท่ากัน 3'),
    ('${T(10)}', '${U1}', 'expense', '${A1}', null, '${C1}', 400, '2026-08-15T03:00:00Z', 'ของเดือนสิงหาคม');

  update transactions set deleted_at = now() where id = '${T(5)}';

  insert into budgets (id, user_id, category_id, period_month, amount) values
    ('${B(1)}', '${U1}', '${C1}', '2026-09-01', 500000),
    ('${B(2)}', '${U1}', '${C1}', '2026-08-01', 400000),
    ('${B(3)}', '${U2}', '${C_U2}', '2026-09-01', 111111);
`);

const db = drizzle(pglite, { schema }) as unknown as Db;

/** นับ query ที่ drizzle ยิงจริง (ดักที่ client ของ PGlite) */
function countingClient() {
  let queries = 0;
  const client = new Proxy(pglite as unknown as Record<string, unknown>, {
    get(target, prop) {
      if (prop === 'query') {
        return (...args: unknown[]) => {
          queries += 1;
          return (Reflect.get(target, 'query') as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      return Reflect.get(target, prop);
    },
  }) as unknown as typeof pglite;
  return { db: drizzle(client, { schema }) as unknown as Db, count: () => queries };
}

/** ไล่ทุกหน้าด้วย keyset จนจบ แล้วคืน id ทั้งหมดตามลำดับที่ได้ */
async function walkAll(database: Db, limit: number, periodMonth?: string) {
  const ids: string[] = [];
  let cursor: { occurredAt: Date; id: string } | undefined;
  let pages = 0;
  let total = 0;
  for (;;) {
    const page = await exportTransactionRows(database, U1, { cursor, limit, periodMonth });
    pages += 1;
    total = page.total;
    ids.push(...page.rows.map((row) => row.id));
    if (!page.nextCursor) return { ids, pages, total };
    cursor = page.nextCursor;
  }
}

test('ส่งออกแถว: ชื่อกระเป๋า/ปลายทาง/หมวด join มาครบ · ลบแล้ว/ของผู้ใช้คนอื่นไม่หลุด', async () => {
  const page = await exportTransactionRows(db, U1, { limit: 100 });
  const byId = new Map(page.rows.map((row) => [row.id, row]));

  assert.equal(byId.has(T(5)), false, 'รายการที่ลบแล้วต้องไม่ออกไฟล์');
  assert.equal(byId.has(T(6)), false, 'รายการของผู้ใช้คนอื่นต้องไม่หลุด');
  assert.equal(page.rows.length, 8, '7 แถวกันยายน + 1 แถวสิงหาคม');
  assert.equal(page.total, 8, 'total = ทั้งชุด (ไม่ใช่แค่หน้านี้)');

  const t1 = byId.get(T(1));
  assert.equal(t1?.accountName, 'เงินสด');
  assert.equal(t1?.categoryName, 'อาหาร, เครื่องดื่ม');
  assert.equal(t1?.toAccountName, null);
  assert.equal(t1?.amount, 25000);
  assert.equal(t1?.currency, 'THB');
  assert.equal(t1?.occurredMonth, '2026-09-01', 'งวดเดือนไทยจากคอลัมน์ generate ของ DB');
  assert.equal(t1?.note?.includes('\n'), true, 'โน้ตหลายบรรทัดต้องมาเต็ม (การ escape เป็นหน้าที่ serializer)');
  assert.ok(t1?.createdAt instanceof Date);

  const t2 = byId.get(T(2));
  assert.equal(t2?.occurredMonth, '2026-09-01', '23:00Z ของวันที่ 13 = วันที่ 14 ไทย (06:00) → งวดไทยคือ 2026-09-01');
});

test('โอนมีชื่อปลายทาง · รับ/จ่ายไม่มี · กระเป๋า/หมวดที่ archive แล้วยังออกชื่อได้', async () => {
  const page = await exportTransactionRows(db, U1, { limit: 100 });
  const byId = new Map(page.rows.map((row) => [row.id, row]));

  assert.equal(byId.get(T(3))?.kind, 'transfer');
  assert.equal(byId.get(T(3))?.toAccountName, 'ธนาคาร');
  assert.equal(byId.get(T(3))?.categoryName, null, 'โอนไม่มีหมวด');
  assert.equal(byId.get(T(2))?.toAccountName, null, 'รับ/จ่ายไม่มีกระเป๋าปลายทาง');

  const old = byId.get(T(4));
  assert.equal(old?.accountName, 'กระเป๋าเก่า', 'กระเป๋าที่ archive แล้วต้องยังออกชื่อ (รายการเก่าอ้างถึง)');
  assert.equal(old?.categoryName, 'หมวดเก่า');
  assert.equal(old?.occurredMonth, '2026-09-01', '31 ส.ค. 17:30Z = 1 ก.ย. 00:30 ไทย → งวดกันยายน');
});

test('keyset ไล่หน้าครบ ไม่ซ้ำ ไม่หาย แม้ occurred_at เท่ากัน · total คงที่ทุกหน้า', async () => {
  const all = await walkAll(db, 2);

  assert.equal(all.ids.length, 8);
  assert.equal(new Set(all.ids).size, 8, 'ห้ามมีแถวซ้ำข้ามหน้า');
  assert.deepEqual(
    all.ids,
    [T(1), T(2), T(3), T(9), T(8), T(7), T(4), T(10)],
    'เรียง occurred_at desc, id desc (t4 = 31 ส.ค. 17:30Z ยังใหม่กว่า t10 = 15 ส.ค.)',
  );
  assert.equal(all.total, 8);
  assert.ok(all.pages >= 4, 'limit 2 กับ 8 แถวต้องได้หลายหน้า');
});

test('กรองตามเดือน: ได้เฉพาะงวดนั้น และ total นับตามตัวกรอง', async () => {
  const august = await exportTransactionRows(db, U1, { periodMonth: '2026-08-01', limit: 100 });
  assert.deepEqual(august.rows.map((row) => row.id), [T(10)]);
  assert.equal(august.total, 1);

  const september = await walkAll(db, 3, '2026-09-01');
  assert.deepEqual(september.ids, [T(1), T(2), T(3), T(9), T(8), T(7), T(4)]);
  assert.equal(september.total, 7);

  assert.equal(await countExportRows(db, U1), 8);
  assert.equal(await countExportRows(db, U1, { periodMonth: '2026-08-01' }), 1);
  assert.equal(await countExportRows(db, U1, { periodMonth: '2026-07-01' }), 0);
});

test('1 query ต่อหน้า (join มาในคำสั่งเดียว — ห้าม N+1)', async () => {
  const { db: counting, count } = countingClient();
  const page = await exportTransactionRows(counting, U1, { limit: 100 });

  assert.equal(page.rows.length, 8);
  assert.equal(count(), 1, '8 แถวที่มีชื่อกระเป๋า/หมวด ต้องมาจาก query เดียว');
});

test('เพดาน 20,000: เกิน → ValidationError ข้อความไทย', () => {
  assert.doesNotThrow(() => assertExportWithinCap(MAX_EXPORT_ROWS));
  assert.throws(
    () => assertExportWithinCap(MAX_EXPORT_ROWS + 1),
    (error: unknown) =>
      error instanceof ValidationError && /20,000/.test(error.message) && /กรองตามเดือน/.test(error.message),
  );
});

test('JSON สำรอง: counts ครบ · กระเป๋า/หมวดที่ archive แล้วอยู่ในไฟล์ · งบทุกเดือน · excludedDeleted ถูก', async () => {
  const snapshot = await buildBackupSnapshot(db, U1);

  assert.equal(snapshot.counts.transactions, 8, 'เฉพาะรายการที่ยังไม่ถูกลบ');
  assert.equal(snapshot.counts.excludedDeleted, 1, 'มีรายการที่ลบแล้ว 1 แถว (t5) และต้องบอกผู้ใช้');
  assert.equal(snapshot.counts.accounts, 3, 'กระเป๋าทั้งหมดของผู้ใช้ (รวมที่ archive)');
  assert.equal(snapshot.counts.categories, 3);
  assert.equal(snapshot.counts.budgets, 2, 'งบทุกเดือน — ไม่งบของผู้ใช้คนอื่น');
  assert.equal(snapshot.accounts.length, snapshot.counts.accounts);
  assert.equal(snapshot.transactions.length, snapshot.counts.transactions);

  const archived = snapshot.accounts.find((account) => account.id === A_OLD);
  assert.notEqual(archived?.archivedAt, null, 'ต้องมีคอลัมน์สถานะสำหรับของที่เลิกใช้');
  assert.equal(snapshot.categories.some((category) => category.id === C_OLD), true);
  assert.deepEqual(
    snapshot.budgets.map((budget) => budget.periodMonth),
    ['2026-08-01', '2026-09-01'],
    'ทุกเดือน เรียงตามเดือน',
  );
  assert.equal(snapshot.accounts.some((account) => account.id === A_U2), false, 'ของผู้ใช้คนอื่นต้องไม่หลุด');
  assert.ok(!Number.isNaN(Date.parse(snapshot.exportedAt)), 'exportedAt ต้องเป็นเวลาที่ใช้ได้');
});

test('แถวจาก DB → CSV: จำนวนบรรทัดตรงและค่าที่โน้ตโหด ๆ รอด round-trip', async () => {
  const page = await exportTransactionRows(db, U1, { limit: 100 });
  const csv = toCsv(page.rows);

  const body = csv.slice(1); // ตัด BOM
  assert.equal(body.startsWith('id,occurred_at,occurred_month,kind,amount_satang'), true);
  // นับบรรทัดจริงไม่ได้ (โน้ตมี \n ในฟิลด์) — ตรวจว่าทุก id ปรากฏและ escape ถูก
  for (const row of page.rows) {
    assert.ok(csv.includes(row.id), `ต้องมี ${row.id} ในไฟล์`);
  }
  assert.ok(csv.includes('"ซื้อ ""กาแฟ""'), 'quote ในโน้ตต้องถูก escape');
  assert.ok(csv.includes('"อาหาร, เครื่องดื่ม"'), 'comma ในชื่อหมวดต้องถูกครอบ');
});

test('5,000 แถว: ไล่หน้าจนครบ · ไม่ซ้ำ · count ตรง · ใช้เวลาไม่นาน', async () => {
  await pglite.exec(`
    insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
    select '${U1}', 'expense', '${A1}', '${C1}', 100 + i,
           timestamptz '2026-07-01 00:00:00+07' + (i || ' minutes')::interval,
           'ก้อนที่ ' || i || ' "ทดสอบ" 🍜'
    from generate_series(1, 5000) as i;
  `);

  const started = performance.now();
  const total = await countExportRows(db, U1);
  const { ids, pages } = await walkAll(db, 1_000);
  const elapsed = performance.now() - started;

  console.log(`[export] DB 5,008 แถว: ${pages} หน้า · ${elapsed.toFixed(0)} ms · countExportRows = ${total}`);
  assert.equal(total, 5_008, '8 แถวเดิม + 5,000 แถวใหม่');
  assert.equal(ids.length, 5_008);
  assert.equal(new Set(ids).size, 5_008, 'ห้ามซ้ำข้ามหน้า (รวมแถวที่ occurred_at เท่ากัน)');
  assert.equal(pages, 6, 'limit 1,000 → 6 หน้า (หน้าสุดท้ายไม่เต็ม)');
  assert.ok(elapsed < 60_000);
});
