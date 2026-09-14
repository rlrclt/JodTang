/**
 * เทสต์หน้า "รายการทั้งหมด" (S4): keyset pagination + ตัวกรอง + จำนวนรวม — PGlite (Postgres จริง)
 * รัน: node --test src/db/queries/transactions-page.test.ts
 *
 * apply DDL จาก docs/schema.sql ตรง ๆ (แหล่งความจริง) ไม่ใช่สำเนา
 * พิสูจน์:
 *   ก) keyset ไล่หน้าจนครบ ไม่ซ้ำ ไม่ขาด (รวมกลุ่ม occurred_at เท่ากันเป๊ะ) + nextCursor = null ตอนจบ
 *   ข) total มาจาก query เดียวกันกับ rows (count(*) over ()) และตรงกับจำนวนแถวจริงใน DB
 *   ค) ตัวกรองแต่ละตัว + ผสมกัน ได้ผลถูก (periodMonth · kind · categoryIds · accountId · q)
 *   ง) q ที่มี % _ \ ต้องไม่ถูกตีความเป็น wildcard
 *   จ) ไม่มี N+1: 1 การเรียก = 1 query (และ categoryIds = [] = 0 query)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import type { KeysetCursor, TxnRow } from './transactions.ts';
import { listTransactionPage } from './transactions.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'u1';
const U2 = 'u2';
const A1 = '11111111-1111-1111-1111-111111111111';
const A2 = '22222222-2222-2222-2222-222222222222';
const A_U2 = '33333333-3333-3333-3333-333333333333';
const C = (n: number) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [C_FOOD, C_RENT, C_SALARY, C_U2E] = [1, 2, 3, 4].map(C);

const SEPT = '2026-09-01';
const AUG = '2026-08-01';
const OCT = '2026-10-01';

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`
  insert into "user" (id, name) values ('${U1}', 'Yoru'), ('${U2}', 'Big');
  insert into accounts (id, user_id, name) values
    ('${A1}', '${U1}', 'เงินสด'), ('${A2}', '${U1}', 'ธนาคาร'), ('${A_U2}', '${U2}', 'ของ u2');
  insert into categories (id, user_id, kind, name) values
    ('${C_FOOD}', '${U1}', 'expense', 'อาหาร'),
    ('${C_RENT}', '${U1}', 'expense', 'ค่าห้อง'),
    ('${C_SALARY}', '${U1}', 'income', 'เงินเดือน'),
    ('${C_U2E}', '${U2}', 'expense', 'ของ u2');

  -- ก.ย. 2569 (u1)
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
    ('${U1}', 'expense', '${A1}', '${C_FOOD}',    18500, timestamptz '2026-09-13 10:00+07', 'ข้าวมันไก่'),
    ('${U1}', 'income',  '${A2}', '${C_SALARY}',2250000, timestamptz '2026-09-13 09:00+07', 'เงินเดือน ก.ย.'),
    ('${U1}', 'expense', '${A1}', '${C_RENT}',   910000, timestamptz '2026-09-12 08:00+07', null),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}',     9500, timestamptz '2026-09-10 07:00+07', 'กาแฟ ลด 50%');
  -- โอนระหว่างกระเป๋าของ u1 (ไม่มีหมวด) — ใช้ทดสอบตัวกรอง accountId ที่ต้อง match ฝั่ง to_account_id ด้วย
  insert into transactions (user_id, kind, account_id, to_account_id, amount, occurred_at, note)
    values ('${U1}', 'transfer', '${A1}', '${A2}', 100000, timestamptz '2026-09-15 10:00+07', 'โอนเข้าแบงก์');
  -- แถวที่ต้องถูกตัดออกเสมอ: soft delete · เดือนอื่น · ของผู้ใช้อื่น
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
    values ('${U1}', 'expense', '${A1}', '${C_FOOD}', 999999, timestamptz '2026-09-14 10:00+07', 'ถูกลบแล้ว');
  update transactions set deleted_at = now() where note = 'ถูกลบแล้ว';
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
    values ('${U1}', 'expense', '${A1}', '${C_FOOD}', 777000, timestamptz '2026-08-15 10:00+07', 'ของเดือน ส.ค.');
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
    ('${U2}', 'expense', '${A_U2}', '${C_U2E}', 500000, timestamptz '2026-09-12 10:00+07', 'ของ u2');

  -- กลุ่มเวลาเท่ากันเป๊ะ 4+3 แถว (keyset tie-break) + note ที่มีอักขระพิเศษของ LIKE
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 1001, timestamptz '2026-10-05 09:00+07', 'tie-A'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 1002, timestamptz '2026-10-05 09:00+07', 'tie-A'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 1003, timestamptz '2026-10-05 09:00+07', 'tie-A'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 1004, timestamptz '2026-10-05 09:00+07', 'tie-A'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 2001, timestamptz '2026-10-04 09:00+07', 'tie-B'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 2002, timestamptz '2026-10-04 09:00+07', 'tie-B'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 2003, timestamptz '2026-10-04 09:00+07', 'tie-B'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 3001, timestamptz '2026-10-03 09:00+07', 'tie-C'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 5000, timestamptz '2026-10-06 09:00+07', 'กาแฟ ลด 50%'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 6000, timestamptz '2026-10-06 09:00+07', 'a_b'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 7000, timestamptz '2026-10-06 09:00+07', 'axb');
`);
await pglite.exec('vacuum analyze transactions');

// driver ของเทสต์เป็น pglite ส่วนแอปใช้ neon-http — query builder ตัวเดียวกัน SQL ที่ได้เหมือนกัน
const db = drizzle(pglite, { schema }) as unknown as Db;

// นับ query จริงที่วิ่งเข้า PGlite (พิสูจน์ว่า 1 การเรียก = 1 query)
let queryCount = 0;
const runQuery = pglite.query.bind(pglite);
pglite.query = ((...args: Parameters<typeof runQuery>) => {
  queryCount += 1;
  return runQuery(...args);
}) as typeof pglite.query;

const liveCount = async (where = 'true') => {
  const result = await pglite.query<{ n: number }>(
    `select count(*)::int as n from transactions where user_id = '${U1}' and deleted_at is null and ${where}`,
  );
  return result.rows[0].n;
};

test('ก) keyset ไล่หน้าจนครบ: ไม่ซ้ำ ไม่ขาด ตาม (occurred_at desc, id desc) และจบด้วย nextCursor = null', async () => {
  const expected = await liveCount();
  assert.ok(expected >= 15, `fixture ต้องมีแถวพอทดสอบหลายหน้า (ได้ ${expected})`);

  // fixture ต้องมีกลุ่มเวลาเท่ากัน ≥3 แถว อย่างน้อย 2 กลุ่ม ไม่งั้นเทสต์นี้พิสูจน์ tie-break อะไรไม่ได้
  const groups = await pglite.query<{ n: number }>(`
    select count(*)::int as n from (
      select occurred_at from transactions where user_id = '${U1}' and deleted_at is null
      group by occurred_at having count(*) >= 3
    ) g`);
  assert.ok(groups.rows[0].n >= 2, `ต้องมีกลุ่มเวลาเท่ากันอย่างน้อย 2 กลุ่ม (ได้ ${groups.rows[0].n})`);

  const seen: TxnRow[] = [];
  let cursor: KeysetCursor | undefined;
  let pages = 0;
  for (let guard = 0; guard < 50; guard++) {
    const page = await listTransactionPage(db, U1, { limit: 3, ...(cursor ? { cursor } : {}) });
    pages += 1;
    assert.equal(page.total, expected, 'total ต้องเท่ากันทุกหน้า (มาจากชุดที่กรองได้ ไม่ใช่แค่หน้านี้)');
    if (page.rows.length === 0) break;
    seen.push(...page.rows);
    cursor = page.nextCursor ?? undefined;
    if (!cursor) break;
  }

  assert.equal(seen.length, expected, 'ต้องเก็บได้ครบทุกแถวโดยไม่ซ้ำ/ไม่ขาด');
  assert.equal(new Set(seen.map((row) => row.id)).size, expected, 'ต้องไม่มี id ซ้ำข้ามหน้า');
  assert.ok(pages > 3, 'ต้องได้หลายหน้า (พิสูจน์ว่า keyset ทำงานจริง)');

  // strict desc ตาม (occurredAt, id): เวลาเท่ากันต้องเทียบ id (uuid เทียบแบบ byte ตรงกับ PG)
  for (let i = 1; i < seen.length; i++) {
    const prev = seen[i - 1];
    const next = seen[i];
    assert.ok(
      prev.occurredAt.getTime() > next.occurredAt.getTime() ||
        (prev.occurredAt.getTime() === next.occurredAt.getTime() && prev.id > next.id),
      `ลำดับผิดที่คู่ ${i}: ${prev.id} (${prev.occurredAt.toISOString()}) กับ ${next.id}`,
    );
  }
  assert.ok(
    seen.every((row) => row.accountId === A1 || row.accountId === A2),
    'ไม่มีแถวของผู้ใช้อื่นปนมา',
  );

  // เทียบกับ query เดียวไม่แบ่งหน้า (ตัวตัดสินสุดท้ายเรื่องลำดับ + tie-break)
  const full = await listTransactionPage(db, U1, { limit: 100 });
  assert.deepEqual(seen.map((row) => row.id), full.rows.map((row) => row.id));
  assert.equal(full.nextCursor, null, 'ดึงครบในหน้าเดียว = ไม่มีหน้าถัดไป');
  assert.equal(full.total, expected);
});

test('ข) total นับเฉพาะแถวที่ตรงตัวกรอง (ไม่ใช่ทั้งหมดของตาราง)', async () => {
  const page = await listTransactionPage(db, U1, { periodMonth: SEPT, kind: 'expense' });
  assert.equal(page.total, await liveCount(`occurred_month_bkk = '${SEPT}' and kind = 'expense'`));
  assert.equal(page.rows.length, page.total, 'default limit 50 ต้องพอสำหรับชุดนี้');
  assert.ok(page.rows.every((row) => row.kind === 'expense'));
});

test('ค) ตัวกรองแต่ละตัวทำงาน และผสมกันได้', async () => {
  const rent = await listTransactionPage(db, U1, { categoryIds: [C_RENT] });
  assert.deepEqual(rent.rows.map((row) => row.amount), [910_000]);

  const foodOrRent = await listTransactionPage(db, U1, { categoryIds: [C_FOOD, C_RENT], limit: 100 });
  assert.equal(foodOrRent.total, await liveCount(`category_id in ('${C_FOOD}', '${C_RENT}')`));

  // accountId ต้อง match ฝั่ง to_account_id ด้วย (โอนเข้า A2) และฝั่ง account_id (เงินเดือนเข้า A2)
  const bank = await listTransactionPage(db, U1, { accountId: A2 });
  assert.deepEqual(bank.rows.map((row) => row.kind), ['transfer', 'income']);
  assert.equal(bank.rows[0].toAccountId, A2);
  assert.equal(bank.rows[1].accountId, A2);

  const transfers = await listTransactionPage(db, U1, { kind: 'transfer' });
  assert.equal(transfers.total, 1);

  const august = await listTransactionPage(db, U1, { periodMonth: AUG });
  assert.deepEqual(august.rows.map((row) => row.amount), [777_000]);

  // ผสมกัน: เดือน ก.ย. + จ่าย + หมวดอาหาร + ค้น 'ข้าว'
  const combo = await listTransactionPage(db, U1, {
    periodMonth: SEPT,
    kind: 'expense',
    categoryIds: [C_FOOD],
    q: 'ข้าว',
  });
  assert.deepEqual(combo.rows.map((row) => row.amount), [18_500]);
  assert.equal(combo.total, 1);

  // ไม่มีอะไรตรง = ว่าง แต่ยังต้องได้ total 0 (ไม่ error)
  const none = await listTransactionPage(db, U1, { q: 'ไม่มีข้อความนี้แน่นอน' });
  assert.deepEqual(none, { rows: [], nextCursor: null, total: 0 });
});

test('ง) ค้นหา: escape % _ \\ — พิมพ์ _ ต้องไม่ match ตัวอื่น', async () => {
  const search = async (q: string) =>
    (await listTransactionPage(db, U1, { q, limit: 100 })).rows.map((row) => row.amount);

  // 'a_b' ที่ไม่ escape จะ match ทั้ง 'a_b' และ 'axb'
  assert.deepEqual(await search('a_b'), [6000]);
  assert.deepEqual(await search('axb'), [7000]);
  // '%' ที่ไม่ escape จะได้ทุกแถวที่มี note (fixture มี 2 แถวที่ note ลงท้ายด้วย 50%)
  assert.deepEqual(await search('%'), [5000, 9500]);
  // '_' ที่ไม่ escape จะได้ทุกแถว (LIKE ใช้ _ เป็น wildcard หนึ่งตัวอักษร)
  assert.deepEqual(await search('_'), [6000]);
  // '\' ที่ไม่ escape จะทำให้ pattern ลงท้ายด้วย escape char = PG error → ต้องไม่พังและได้ 0 แถว
  assert.deepEqual(await search('\\'), []);
});

test('จ) 1 การเรียก = 1 query (rows + total มาจาก query เดียว) · categoryIds = [] = 0 query', async () => {
  queryCount = 0;
  const page = await listTransactionPage(db, U1, { periodMonth: SEPT, limit: 2 });
  assert.equal(queryCount, 1, 'rows + total + nextCursor ต้องมาจาก query เดียว');
  assert.equal(page.total, 5, 'ก.ย. ของ u1 มี 5 แถวที่ยังไม่ถูกลบ (4 รับ/จ่าย + 1 โอน)');

  queryCount = 0;
  const none = await listTransactionPage(db, U1, { categoryIds: [] });
  assert.deepEqual(none, { rows: [], nextCursor: null, total: 0 });
  assert.equal(queryCount, 0, 'ไม่มีหมวดให้กรอง = ไม่ต้องยิง DB');
});

test('ช) total ไม่หดเมื่อไล่หน้า (นับจากชุดที่กรองได้ ไม่ใช่แค่ช่วง cursor)', async () => {
  const expected = await liveCount(`occurred_month_bkk = '${SEPT}'`);

  let cursor = (await listTransactionPage(db, U1, { periodMonth: SEPT, limit: 2 })).nextCursor;
  assert.ok(cursor, 'ต้องมีหน้าถัดไป');
  for (let page = 2; page <= 3 && cursor; page++) {
    const next = await listTransactionPage(db, U1, { periodMonth: SEPT, limit: 2, cursor });
    assert.equal(next.total, expected, `total หน้า ${page} ต้องเท่ากับยอดของทั้งเดือน`);
    cursor = next.nextCursor;
  }
});

test('ฌ) ค้นหา q ครอบทั้ง note และชื่อหมวด (ไม่ match อะไรเลยต้องยังคืนตามตัวกรองอื่น)', async () => {
  const ids = async (filters: Parameters<typeof listTransactionPage>[2]) =>
    (await listTransactionPage(db, U1, { limit: 100, ...filters })).rows.map((row) => row.amount);

  // 'อาหาร' ไม่มีอยู่ใน note ใดเลย → ที่ได้ต้องมาจากชื่อหมวดล้วน ๆ
  const byCategoryName = await listTransactionPage(db, U1, { q: 'อาหาร', limit: 100 });
  assert.equal(byCategoryName.total, await liveCount(`category_id = '${C_FOOD}'`));
  assert.deepEqual(byCategoryName.rows.map((row) => row.categoryId), Array(byCategoryName.total).fill(C_FOOD));

  // 'กาแฟ' มีใน note → ต้องเจอด้วย
  assert.deepEqual(await ids({ q: 'กาแฟ' }), [5000, 9500]);

  // ชื่อหมวดของ "ค่าห้อง" → เจอเฉพาะรายการของหมวดนั้น
  assert.deepEqual(await ids({ q: 'ค่าห้อง' }), [910000]);

  // กับดักที่ designer เตือน: คำค้นต้องไม่ถูก "กลืน" ตอนไม่มีหมวดชื่อตรง
  // (ถ้าเขียนเป็น and(ilike(note), inArray(categoryId, [])) → inArray([]) เป็น false → ได้ 0 แถวทั้งที่โน้ตตรง)
  // q = 'ข้าว' ตรงเฉพาะโน้ต (ไม่มีหมวดชื่อ 'ข้าว') → ต้องยังได้แถวนั้น
  assert.deepEqual(await ids({ q: 'ข้าว' }), [18500]);

  // q ที่ไม่ match ทั้ง note และชื่อหมวด → 0 แถว (พฤติกรรมการค้นหาที่ถูก) แต่ตัวกรองอื่นต้องยังทำงานปกติ
  const noMatch = await listTransactionPage(db, U1, { q: 'zzz ไม่มีจริง', periodMonth: SEPT });
  assert.equal(noMatch.total, 0);
  const withoutQ = await listTransactionPage(db, U1, { periodMonth: SEPT });
  assert.equal(
    withoutQ.total,
    await liveCount(`occurred_month_bkk = '${SEPT}'`),
    'ตัวกรองอื่นต้องไม่ถูกกระทบจาก q ที่ไม่ match',
  );
});

test('ญ) ไล่ N หน้าในคำขอเดียว (?pages=N) deterministic — 2 รอบได้ลำดับเดิม และไม่มี id ซ้ำ/ขาด', async () => {
  const walk = async (pages: number) => {
    const collected: string[] = [];
    let cursor: KeysetCursor | undefined;
    for (let page = 0; page < pages; page++) {
      const result = await listTransactionPage(db, U1, { periodMonth: OCT, limit: 3, ...(cursor ? { cursor } : {}) });
      collected.push(...result.rows.map((row) => row.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return collected;
  };

  const first = await walk(3);
  const second = await walk(3);

  assert.equal(first.length, 9, '3 หน้า × 3 แถว (ต.ค. มี 11 แถว)');
  assert.deepEqual(second, first, 'วนซ้ำด้วย input เดิมต้องได้ลำดับเดิมเป๊ะ (deterministic)');
  assert.equal(new Set(first).size, first.length, 'ไม่มี id ซ้ำข้ามหน้า');
  assert.equal(await liveCount(`occurred_month_bkk = '${OCT}'`), 11, 'fixture ต้องมี 11 แถวใน ต.ค. (มีกลุ่มเวลาเท่ากัน)');
});

test('ฎ) หน้าสุดท้ายที่ว่าง (cursor เลยแถวสุดท้าย) ต้องยังรายงาน total ของทั้งชุด ไม่ใช่ 0', async () => {
  const expected = await liveCount(`occurred_month_bkk = '${SEPT}'`);
  const all = await listTransactionPage(db, U1, { periodMonth: SEPT, limit: 100 });
  const tail = all.rows[all.rows.length - 1];

  queryCount = 0;
  const beyond = await listTransactionPage(db, U1, {
    periodMonth: SEPT,
    limit: 5,
    cursor: { occurredAt: tail.occurredAt, id: tail.id },
  });

  assert.deepEqual(beyond.rows, [], 'เลยแถวสุดท้าย = ไม่มีแถวในหน้านี้');
  assert.equal(beyond.nextCursor, null);
  assert.equal(beyond.total, expected, 'total ต้องเท่ากับยอดของทั้งเดือน ไม่ใช่ 0 (บั๊กที่รีวิวเจอ: ผู้ใช้เห็น "0 รายการ")');
  assert.equal(
    queryCount,
    2,
    'กรณีนี้เป็นข้อยกเว้นที่ตั้งใจ: query หลัก (ว่าง) + count เพิ่ม 1 ครั้ง เพราะไม่มีแถวให้อ่านคอลัมน์ total',
  );
});

test('limit ถูก clamp ให้อยู่ในช่วงที่ปลอดภัย (0/ติดลบ = 1 แถว, เกินเพดาน = 100)', async () => {
  assert.equal((await listTransactionPage(db, U1, { limit: 0 })).rows.length, 1);
  assert.equal((await listTransactionPage(db, U1, { limit: -5 })).rows.length, 1);
  const big = await listTransactionPage(db, U1, { limit: 10_000 });
  assert.equal(big.rows.length, big.total, 'limit เกินเพดานต้องยังคืนได้ครบเท่าที่มีจริง');

  // cursor ต้องพาไปหน้าถัดไปจริง (id อื่นทั้งหมด)
  const first = await listTransactionPage(db, U1, { limit: 1 });
  assert.ok(first.nextCursor);
  const second = await listTransactionPage(db, U1, { limit: 1, cursor: first.nextCursor });
  assert.notEqual(second.rows[0].id, first.rows[0].id);
});

test('คำค้นยาวเกิน 200 ตัวอักษรถูกตัดที่ขอบ (ไม่ error) — audit F4', async () => {
  // note = 'B' × 200 พอดี: คำค้น 'B'×200 + 'C' (201 ตัว) ถ้าไม่ตัดจะไม่ match (โน้ตไม่มี C)
  await pglite.exec(`
    insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
      values ('${U1}', 'expense', '${A1}', '${C_FOOD}', 4242, timestamptz '2026-07-01 10:00+07', '${'B'.repeat(200)}');
  `);

  const long = await listTransactionPage(db, U1, { q: `${'B'.repeat(200)}C`, limit: 100 });
  assert.deepEqual(long.rows.map((row) => row.amount), [4242], 'คำค้นถูกตัดเหลือ 200 ตัว → ยัง match โน้ตได้');

  const exact = await listTransactionPage(db, U1, { q: 'B'.repeat(200), limit: 100 });
  assert.deepEqual(exact.rows.map((row) => row.amount), [4242], 'คำค้นที่พอดี 200 ตัวก็ยังทำงาน');
});
