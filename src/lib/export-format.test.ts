/**
 * เทสต์ serializer ของไฟล์ส่งออก (pure — ไม่แตะ DB/request)
 * รัน: node --test src/lib/export-format.test.ts
 *
 * กติกาที่ต้องไม่พลาด (สเปก local://wave27-design.md §2):
 *   - CSV: UTF-8 + BOM · คั่น comma · ลงท้าย CRLF ทุกบรรทัด · quote ตาม RFC 4180
 *     (ครอบด้วย " เมื่อมี comma/" /ขึ้นบรรทัดใหม่/ช่องว่างหัวท้าย แล้วซ้ำ " เป็น "")
 *   - คอลัมน์: id, occurred_at (ISO +07:00), occurred_month, kind, amount_satang, amount_thb, currency,
 *     account_name, to_account_name, category_name, note, created_at
 *   - amount_thb = สตริงทศนิยม 2 ตำแหน่ง **ห้ามมี ฿ หรือ , ** (ชีตต้องคำนวณได้)
 *   - JSON: compact · จำนวนเงินเป็นสตางค์จำนวนเต็มเท่านั้น · ไม่มี BOM
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CSV_HEADERS, toCsv, toJson, type BackupData, type ExportRow } from './export-format.ts';

/** แถวตัวอย่าง (สตางค์จำนวนเต็มบวกเสมอ — ทิศทางมาจาก kind) */
const row = (patch: Partial<ExportRow> = {}): ExportRow => ({
  id: '11111111-1111-1111-1111-111111111111',
  occurredAt: new Date('2026-09-14T10:30:00Z'), // = 17:30 น. ไทย
  occurredMonth: '2026-09-01',
  kind: 'expense',
  amount: 25_000,
  currency: 'THB',
  accountName: 'เงินสด',
  toAccountName: null,
  categoryName: 'อาหาร',
  note: null,
  createdAt: new Date('2026-09-14T10:31:00Z'),
  ...patch,
});

const snapshot = (transactions: ExportRow[] = [row()]): BackupData => ({
  exportedAt: '2026-09-14T12:00:00.000Z',
  counts: { accounts: 1, categories: 2, budgets: 0, transactions: transactions.length, excludedDeleted: 3 },
  accounts: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'เงินสด',
      kind: 'cash',
      currency: 'THB',
      initialBalance: 100_000,
      icon: null,
      color: null,
      archivedAt: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'ธนาคารเก่า',
      kind: 'bank',
      currency: 'THB',
      initialBalance: 0,
      icon: null,
      color: null,
      archivedAt: new Date('2026-09-10T00:00:00Z'),
      createdAt: new Date('2026-09-01T00:00:00Z'),
    },
  ],
  categories: [
    {
      id: '44444444-4444-4444-4444-444444444444',
      kind: 'expense',
      name: 'อาหาร',
      icon: null,
      color: null,
      sortOrder: 0,
      archivedAt: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
    },
  ],
  budgets: [
    {
      id: '55555555-5555-5555-5555-555555555555',
      categoryId: '44444444-4444-4444-4444-444444444444',
      periodMonth: '2026-09-01',
      amount: 500_000,
      currency: 'THB',
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date('2026-09-01T00:00:00Z'),
    },
  ],
  transactions,
});

/**
 * CSV parser ขนาดเล็กสำหรับ round-trip (เขียนในเทสต์ ไม่ใช้ของจริง — ตัว escape ผิดเมื่อไร parser นี้เห็นทันที)
 * รองรับ " ครอบฟิลด์ · "" = " ตัวเดียว · ขึ้นบรรทัดใหม่ในฟิลด์ · CRLF เป็นตัวจบบรรทัด
 */
function parseCsv(text: string): string[][] {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const lines: string[][] = [];
  let field = '';
  let fields: string[] = [];
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else { field += char; }
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { fields.push(field); field = ''; continue; }
    if (char === '\r' && body[i + 1] === '\n') {
      fields.push(field);
      lines.push(fields);
      fields = [];
      field = '';
      i += 1;
      continue;
    }
    field += char;
  }
  assert.equal(quoted, false, 'ต้องปิดเครื่องหมายคำพูดครบ');
  return lines;
}

test('CSV: BOM + หัวคอลัมน์ตามสเปก + ลงท้ายทุกบรรทัดด้วย CRLF', () => {
  const csv = toCsv([row()]);

  assert.ok(csv.startsWith('\uFEFF'), 'ต้องมี BOM นำหน้า (Excel/Sheets อ่านไทยถูก)');
  assert.ok(csv.endsWith('\r\n'), 'บรรทัดสุดท้ายต้องจบด้วย CRLF');
  assert.equal(csv.replace(/\r\n/g, '').includes('\n'), false, 'ห้ามมี \\n เดี่ยว ๆ ในไฟล์');

  const lines = parseCsv(csv);
  assert.deepEqual(lines[0], [...CSV_HEADERS]);
  assert.deepEqual(lines[0], [
    'id', 'occurred_at', 'occurred_month', 'kind', 'amount_satang', 'amount_thb', 'currency',
    'account_name', 'to_account_name', 'category_name', 'note', 'created_at',
  ]);
  assert.deepEqual(lines[1], [
    '11111111-1111-1111-1111-111111111111',
    '2026-09-14T17:30:00+07:00',
    '2026-09-01',
    'expense',
    '25000',
    '250.00',
    'THB',
    'เงินสด',
    '',
    'อาหาร',
    '',
    '2026-09-14T17:31:00+07:00',
  ]);
  assert.equal(lines.length, 2);
});

test('จำนวนเงิน: satang เป็นจำนวนเต็ม · thb ทศนิยม 2 ตำแหน่ง ไม่มี ฿/, (รวมเคส 0.05 บาท)', () => {
  const lines = parseCsv(
    toCsv([
      row({ amount: 5 }), // 0.05 บาท — เคสที่สเปก §6.3 ระบุ
      row({ amount: 123_456 }), // 1,234.56
      row({ amount: 100 }), // 1.00
      row({ amount: 9_999_999_999 }), // 99,999,999.99 (ไม่ใส่ตัวคั่นหลักพัน)
    ]),
  );

  const rows = lines.slice(1);
  assert.deepEqual(rows.map((line) => [line[4], line[5]]), [
    ['5', '0.05'],
    ['123456', '1234.56'],
    ['100', '1.00'],
    ['9999999999', '99999999.99'],
  ]);
  for (const line of rows) {
    assert.equal(/[฿,]/.test(line[5]), false, 'คอลัมน์ตัวเลขห้ามมี ฿ หรือ ,');
    assert.match(line[5], /^\d+\.\d{2}$/);
  }
});

test('escape ตาม RFC 4180: comma · quote · ขึ้นบรรทัดใหม่ · ช่องว่างหัวท้าย · ไทย · emoji', () => {
  const messy = row({
    accountName: '  เงินสด  ', // ช่องว่างหัวท้าย
    categoryName: 'อาหาร, เครื่องดื่ม"พิเศษ"', // comma + quote
    note: 'ซื้อ "กาแฟ" 3 แก้ว\r\nแล้วต่อด้วยข้าว\nและของหวาน 🍰', // quote + CRLF + LF + emoji
  });

  const csv = toCsv([messy]);
  const [, data] = parseCsv(csv);

  assert.equal(data[7], '  เงินสด  ', 'ช่องว่างหัวท้ายต้องรอด round-trip (จึงต้องครอบด้วย ")');
  assert.equal(data[9], 'อาหาร, เครื่องดื่ม"พิเศษ"');
  assert.equal(data[10], 'ซื้อ "กาแฟ" 3 แก้ว\r\nแล้วต่อด้วยข้าว\nและของหวาน 🍰');
  assert.match(csv, /"อาหาร, เครื่องดื่ม""พิเศษ"""/);
  assert.match(csv, /"ซื้อ ""กาแฟ"" 3 แก้ว/);
});

test('โอนมีชื่อกระเป๋าปลายทาง · รับ/จ่ายไม่มี · null → ช่องว่าง', () => {
  const lines = parseCsv(
    toCsv([
      row({ kind: 'transfer', toAccountName: 'ธนาคาร', categoryName: null }),
      row({ kind: 'income', categoryName: 'เงินเดือน', note: 'โบนัส' }),
    ]),
  );

  assert.equal(lines[1][3], 'transfer');
  assert.equal(lines[1][8], 'ธนาคาร');
  assert.equal(lines[1][9], '', 'โอนไม่มีหมวด → ช่องว่าง');
  assert.equal(lines[2][3], 'income');
  assert.equal(lines[2][8], '', 'รับ/จ่ายไม่มีกระเป๋าปลายทาง');
  assert.equal(lines[2][10], 'โบนัส');
});

test('วันที่เป็นเวลาไทย (+07:00) — ข้ามเดือน/ข้ามปีถูกต้อง', () => {
  const lines = parseCsv(
    toCsv([
      row({ occurredAt: new Date('2026-12-31T17:30:00Z'), occurredMonth: '2027-01-01' }), // 2027-01-01 00:30 ไทย
      row({ occurredAt: new Date('2026-12-31T16:59:59Z'), occurredMonth: '2026-12-01' }), // 2026-12-31 23:59:59 ไทย
      row({ occurredAt: new Date('2026-09-01T00:00:00Z'), occurredMonth: '2026-09-01' }), // 2026-09-01 07:00 ไทย
    ]),
  );

  assert.deepEqual(lines.slice(1).map((line) => [line[1], line[2]]), [
    ['2027-01-01T00:30:00+07:00', '2027-01-01'],
    ['2026-12-31T23:59:59+07:00', '2026-12-01'],
    ['2026-09-01T07:00:00+07:00', '2026-09-01'],
  ]);
});

test('สตางค์ที่ไม่ใช่จำนวนเต็มต้องล้มเสียงดัง (ไม่เงียบกลายเป็นไฟล์เพี้ยน)', () => {
  assert.throws(() => toCsv([row({ amount: 12.5 })]), TypeError);
  assert.throws(() => toCsv([row({ amount: Number.MAX_SAFE_INTEGER + 2 })]), TypeError);
  assert.throws(() => toJson(snapshot([row({ amount: 12.5 })])), TypeError);
});

test('ไฟล์ว่างยังเป็นไฟล์ที่ถูกต้อง (CSV มีแต่หัวตาราง)', () => {
  assert.equal(toCsv([]), `\uFEFF${CSV_HEADERS.join(',')}\r\n`);
  assert.equal(parseCsv(toCsv([])).length, 1);
});

test('JSON: compact · ไม่มี BOM · เงินเป็นสตางค์จำนวนเต็ม · Date เป็น ISO', () => {
  const text = toJson(snapshot());

  assert.equal(text.startsWith('\uFEFF'), false, 'JSON ไม่ต้องมี BOM');
  assert.equal(text.includes('\n'), false, 'ต้องเป็น compact (ไม่มี indent/ขึ้นบรรทัดใหม่)');

  const parsed = JSON.parse(text) as BackupData;
  assert.equal(parsed.exportedAt, '2026-09-14T12:00:00.000Z');
  assert.deepEqual(parsed.counts, {
    accounts: 1,
    categories: 2,
    budgets: 0,
    transactions: 1,
    excludedDeleted: 3,
  });
  assert.equal(parsed.transactions[0].amount, 25_000, 'สตางค์จำนวนเต็ม (ไม่หาร 100)');
  assert.equal(parsed.transactions[0].occurredAt as unknown as string, '2026-09-14T10:30:00.000Z');
  assert.equal(parsed.accounts[0].initialBalance, 100_000);
  assert.equal(parsed.accounts[1].archivedAt as unknown as string, '2026-09-10T00:00:00.000Z', 'กระเป๋าที่ archive แล้วต้องอยู่ในไฟล์');
  assert.equal(parsed.budgets[0].amount, 500_000);
});

test('กัน formula injection ใน CSV (= + - @ TAB CR) แต่ JSON ต้องคงค่าจริง (ไม่ดัด)', () => {
  const rows = [
    row({ note: '=1+1' }),
    row({ note: '=HYPERLINK("http://x","y")' }),
    row({ note: '-5 บาท' }),
    row({ note: '@ผู้ใช้' }),
    row({ note: '+66 81 234 5678' }),
    row({ note: '\t=TAB' }),
    row({ note: 'ปกติ ไม่มีอะไรอันตราย' }),
    row({ categoryName: 'อาหาร' }),
  ];
  const lines = parseCsv(toCsv(rows));

  assert.deepEqual(
    lines.slice(1).map((line) => line[10]),
    [
      "'=1+1",
      `'=HYPERLINK("http://x","y")`,
      "'-5 บาท",
      "'@ผู้ใช้",
      "'+66 81 234 5678",
      "'\t=TAB",
      'ปกติ ไม่มีอะไรอันตราย', // แถวปกติห้ามถูกเติม ' โดยไม่จำเป็น
      '',
    ],
  );
  // อักขระอันตรายยังต้องผ่านการ escape ของ RFC 4180 ตามปกติ
  assert.ok(toCsv([row({ note: '=1,2' })]).includes(`"'=1,2"`));

  // JSON = ไฟล์สำรอง: ค่าจริงต้องอยู่ครบ ไม่ถูกดัด
  const parsed = JSON.parse(toJson(snapshot(rows))) as BackupData;
  assert.deepEqual(
    parsed.transactions.map((entry) => entry.note),
    ['=1+1', '=HYPERLINK("http://x","y")', '-5 บาท', '@ผู้ใช้', '+66 81 234 5678', '\t=TAB', 'ปกติ ไม่มีอะไรอันตราย', null],
  );
});

test('5,000 แถว: serialize ได้เร็วและไม่กินหน่วยความจำเกินควร (วัดเวลา + heapUsed)', () => {
  const rows: ExportRow[] = Array.from({ length: 5_000 }, (_, i) =>
    row({
      id: `11111111-1111-1111-1111-${String(i).padStart(12, '0')}`,
      amount: 1_000 + i,
      accountName: `กระเป๋า ${i % 7}`,
      categoryName: 'อาหาร, เครื่องดื่ม',
      note: `รายการที่ ${i} "ทดสอบ" 🍜`,
    }),
  );

  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const csv = toCsv(rows);
  const json = toJson(snapshot(rows));
  const elapsed = performance.now() - started;
  const heapDelta = process.memoryUsage().heapUsed - heapBefore;
  console.log(
    `[export] 5,000 แถว: CSV ${(csv.length / 1024).toFixed(0)} KiB · JSON ${(json.length / 1024).toFixed(0)} KiB · ` +
      `${elapsed.toFixed(0)} ms · heap ต่าง ${(heapDelta / 1024 / 1024).toFixed(1)} MiB`,
  );

  assert.equal(parseCsv(csv).length - 1, 5_000);
  assert.equal((JSON.parse(json) as BackupData).transactions.length, 5_000);
  // ขอบเขตหลวม ๆ: ถ้าเขียน O(n²) หรือสร้างสตริงซ้ำ ตัวเลขนี้ทะลุทันที (ค่าจริงวัดได้ ~50-150 ms / <25 MiB)
  assert.ok(elapsed < 2_000, `serialize 5,000 แถวใช้เวลา ${elapsed.toFixed(0)} ms`);
  assert.ok(heapDelta < 128 * 1024 * 1024, `heap เพิ่ม ${(heapDelta / 1024 / 1024).toFixed(1)} MiB`);
});
