/**
 * เทสต์ตัวกรอง log (pure) — หัวใจคือ "ค่าจริงต้องไม่หลุดออกไปในบรรทัด log"
 * รัน: node --test src/lib/log.test.ts
 *
 * เคสที่ต้องผ่าน: อีเมล (ทั้งเป็นค่าและซ่อนในข้อความ error ของ PG) · token/JWT · ค่ายาวเกิน ·
 * วัตถุซ้อน/อาเรย์ · userId (ต้องไม่ดิบ) · ค่าที่ JSON เก็บไม่ได้ (Date/BigInt/function) · ยังต้อง parse ได้เสมอ
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { logServer, safeFields, serializeLog, userIdDigest } from './log.ts';

const SECRET_EMAIL = 'somchai.jaidee@example.com';
const SECRET_TOKEN = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY1234567890';

test('รูปร่างบรรทัด log: JSON บรรทัดเดียว + t/lvl/event และยก route/code/digest ขึ้นบนสุด', () => {
  const line = serializeLog(
    'session.read_failed',
    { level: 'warn', route: '/settings', code: '23505', digest: 'DYNAMIC_SERVER_USAGE' },
    new Date('2026-09-14T10:00:00Z'),
  );

  assert.equal(line.includes('\n'), false, 'ต้องเป็นบรรทัดเดียว');
  assert.deepEqual(JSON.parse(line), {
    t: '2026-09-14T10:00:00.000Z',
    lvl: 'warn',
    event: 'session.read_failed',
    route: '/settings',
    code: '23505',
    digest: 'DYNAMIC_SERVER_USAGE',
  });
  assert.equal(serializeLog('x', {}, new Date('2026-09-14T10:00:00Z')).includes('"lvl":"error"'), true, 'ค่าเริ่มต้นคือ error');
});

test('คีย์อันตรายถูกตัด และค่าจริงไม่โผล่ในบรรทัด log', () => {
  const line = serializeLog('action.save_failed', {
    email: SECRET_EMAIL,
    note: 'ซื้อของให้แม่',
    name: 'สมชาย ใจดี',
    amount: 250_000,
    token: SECRET_TOKEN,
    cookie: 'better-auth.session_token=abc.def',
    authorization: 'Bearer xyz',
    password: 'hunter2',
    secret: 'shhh',
  });

  for (const leaked of [SECRET_EMAIL, 'ซื้อของให้แม่', 'สมชาย ใจดี', '250000', SECRET_TOKEN, 'abc.def', 'Bearer xyz', 'hunter2', 'shhh']) {
    assert.equal(line.includes(leaked), false, `ห้ามพบ "${leaked}" ใน log`);
  }
  const parsed = JSON.parse(line) as Record<string, string>;
  assert.equal(parsed.email, '[ตัด: ข้อมูลส่วนตัว]');
  assert.equal(parsed.token, '[ตัด: ข้อมูลส่วนตัว]');
  assert.equal(parsed.cookie, '[ตัด: ข้อมูลส่วนตัว]');
  assert.equal(parsed.authorization, '[ตัด: ข้อมูลส่วนตัว]');
  assert.equal(parsed.note, '[ตัด: ข้อมูลส่วนตัว]');
  assert.equal(parsed.name, '[ตัด: ข้อมูลส่วนตัว]');
  assert.equal(parsed.amount, '[ตัด: ข้อมูลส่วนตัว]');
  // คีย์ที่ชื่อคลุมเครือแต่ลงท้ายด้วยคำอันตรายก็ต้องถูกตัด (กันการตั้งชื่อเลี่ยง)
  assert.equal(JSON.parse(serializeLog('x', { userEmail: SECRET_EMAIL })).userEmail, '[ตัด: ข้อมูลส่วนตัว]');
  assert.equal(JSON.parse(serializeLog('x', { session_token: 'abc' })).session_token, '[ตัด: ข้อมูลส่วนตัว]');
});

test('ข้อความ error ที่ PG แนบอีเมล/token มา ถูกปิดก่อนออก log', () => {
  const pgError = Object.assign(
    new Error(`duplicate key value violates unique constraint "user_email_key" Key (email)=(${SECRET_EMAIL}) already exists`),
    { code: '23505' },
  );
  const line = serializeLog('db.write_rejected', { error: pgError, route: '/settings' });

  assert.equal(line.includes(SECRET_EMAIL), false, 'อีเมลในข้อความ error ต้องถูกปิด');
  // รูปแบบที่เหลือ = ตัวแรกของ local part + *** + โดเมน (ตามกติกา `a***@domain`)
  assert.equal(line.includes('s***@example.com'), true, 'ต้องเหลือรูปแบบที่ตามรอยได้');
  assert.equal(line.includes('somchai'), false, 'ชื่อ local part ต้องไม่หลุด');
  const parsed = JSON.parse(line) as { code: string; error: { message: string } };
  assert.equal(parsed.code, '23505', 'รหัส PG ขึ้นมาอยู่บนสุดเพื่อให้กรอง log ตามรหัสได้');
  assert.equal(parsed.error.message.includes('s***@example.com'), true);

  const jwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${SECRET_TOKEN}`;
  const another = serializeLog('auth.failed', { error: new Error(`token หมดอายุ: ${jwt}`) });
  assert.equal(another.includes(SECRET_TOKEN), false, 'JWT/token ยาว ๆ ต้องถูกปิด');

  // เคสจริงที่เจอตอนทดสอบ: token แบบ base64 มี `/` `+` `=` ปน → ต้องถูกปิด (เดิมหลุดเพราะชุดอักขระไม่รวม `/`)
  const base64Token = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY1234567890';
  const withBase64 = serializeLog('auth.failed', { error: new Error(`Authorization: Bearer ${base64Token}`) });
  assert.equal(withBase64.includes(base64Token), false);
  assert.equal(withBase64.includes('[ตัด]'), true);
});

test('userId ไม่เคยออกดิบ — ออกเป็นรหัสย่อที่เสถียร', () => {
  const raw = 'verify29-1789375354378'; // id ที่อ่านออกได้ (แบบที่ fixture ใช้) ⇒ ห้ามหลุด
  const line = serializeLog('session.read_failed', { userId: raw });

  assert.equal(line.includes(raw), false);
  const parsed = JSON.parse(line) as { user: string };
  assert.match(parsed.user, /^[0-9a-f]{8}$/);
  assert.equal(parsed.user, userIdDigest(raw), 'ค่าเดิมต้องได้รหัสเดิม (ตามรอยข้ามคำขอได้)');
  assert.notEqual(userIdDigest(raw), userIdDigest(`${raw}x`), 'คนละผู้ใช้ต้องคนละรหัส');
  assert.equal((JSON.parse(serializeLog('x', { userId: '' })) as { user: string }).user, '[ไม่มีผู้ใช้]');
});

test('ค่ายาวเกินถูกตัดที่ ~200 ตัวอักษร และค่ายังอ่านออก', () => {
  const long = 'ก'.repeat(500);
  const parsed = JSON.parse(serializeLog('x', { detail: long })) as { detail: string };

  assert.ok(parsed.detail.length <= 200, `ยาว ${parsed.detail.length}`);
  assert.equal(parsed.detail.endsWith('…'), true);
  assert.equal(parsed.detail.startsWith('กกก'), true);
});

test('วัตถุซ้อน/อาเรย์ ถูกกรองด้วยกติกาเดียวกัน (ลึก/กว้าง มีขอบเขต)', () => {
  const line = serializeLog('export.failed', {
    context: { token: SECRET_TOKEN, email: SECRET_EMAIL, items: [{ note: 'ความลับ' }, 'ปกติ'] },
    tags: Array.from({ length: 12 }, (_, index) => `t${index}`),
    deep: { a: { b: { c: { d: 'ลึกมาก' } } } },
  });

  assert.equal(line.includes(SECRET_TOKEN), false);
  assert.equal(line.includes('ความลับ'), false, 'คีย์อันตรายในวัตถุซ้อนต้องถูกตัดด้วย');
  const parsed = JSON.parse(line) as {
    context: { token: string; items: unknown[] };
    tags: unknown[];
    deep: { a: { b: unknown } };
  };
  assert.equal(parsed.context.token, '[ตัด: ข้อมูลส่วนตัว]');
  // สมาชิกอาเรย์ที่เป็นวัตถุก็ถูกไล่กรองต่อ (คีย์ `note` ถูกตัด เหลือร่องรอยว่าเคยมีค่า)
  assert.deepEqual(parsed.context.items, [{ note: '[ตัด: ข้อมูลส่วนตัว]' }, 'ปกติ']);
  assert.equal(parsed.tags.length, 9, 'เก็บ 8 ตัวแรก + ตัวบอกจำนวนที่เหลือ');
  assert.equal(parsed.tags[8], '[+4]');
  assert.equal(JSON.stringify(parsed.deep).includes('ลึกมาก'), false, 'เกินความลึกที่กำหนด = ตัด');
});

test('ค่าที่ JSON.stringify ตรง ๆ ไม่ได้ ยังออกเป็น JSON ที่ parse ได้', () => {
  const line = serializeLog('x', {
    when: new Date('2026-09-14T10:00:00Z'),
    big: BigInt(123), // ไม่ใช้ literal 123n เพราะ tsconfig target ต่ำกว่า ES2020
    fn: () => 'secret inside',
    nothing: undefined,
    nan: Number.NaN,
  });

  const parsed = JSON.parse(line) as Record<string, unknown>;
  assert.equal(parsed.when, '2026-09-14T10:00:00.000Z');
  assert.equal(parsed.big, '123');
  assert.equal(parsed.fn, '[ฟังก์ชัน]');
  // undefined หายไปจาก JSON ตามปรกติของ JSON — ไม่ทำให้ทั้งบรรทัดพัง
  assert.equal('nothing' in parsed, false);
  assert.equal(typeof parsed.nan, 'string');
});

test('safeFields เป็น pure: ไม่แก้วัตถุต้นทาง', () => {
  const input = { email: SECRET_EMAIL, nested: { token: SECRET_TOKEN } };
  const before = JSON.stringify(input);
  const out = safeFields(input);

  assert.equal(out.email, '[ตัด: ข้อมูลส่วนตัว]');
  assert.equal(JSON.stringify(input), before, 'ต้นทางต้องไม่ถูกแก้');
});

test('getter/toJSON ที่โยน ทำให้ log ยังออกได้ แต่ห้ามโยนออกจาก logServer (ไม่งั้นคำขอพังเป็น 500)', () => {
  const poisonedMessage = Object.defineProperty(new Error('ปกติ'), 'message', {
    get() {
      throw new Error('getter ระเบิด');
    },
  });
  const poisonedName = Object.defineProperty(new Error('ปกติ'), 'name', {
    get() {
      throw new Error('getter ระเบิด');
    },
  });
  const poisonedField = { get email() { throw new Error('getter ระเบิด'); }, ok: 'ปกติ' };
  const throwingToJson = { toJSON() { throw new Error('toJSON ระเบิด'); }, value: 'x' };
  const circular: Record<string, unknown> = { label: 'วงกลม' };
  circular.self = circular;
  const throwingProxy = new Proxy({}, { ownKeys() { throw new Error('ownKeys ระเบิด'); } });

  const lines: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => lines.push(String(line));
  try {
    for (const fields of [
      { error: poisonedMessage },
      { error: poisonedName },
      { context: poisonedField },
      { context: throwingToJson },
      { context: circular },
      { [Symbol('sym')]: 'symbol key' },
      { context: throwingProxy },
      { error: poisonedMessage, userId: 'u-1' },
    ]) {
      // หัวใจของ finding 1: ต้องไม่โยน
      assert.doesNotThrow(() => logServer('probe.event', fields as never), `logServer โยนกับ ${String(Object.keys(fields))}`);
    }
    // fields ที่เป็น getter พังก็ต้องไม่โยน
    assert.doesNotThrow(() => logServer('probe.event', poisonedField as never));
    assert.doesNotThrow(() => serializeLog('probe.event', { error: poisonedMessage }));
  } finally {
    console.error = original;
  }

  assert.equal(lines.length, 9, 'ทุกครั้งต้องยังออก log หนึ่งบรรทัด');
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line), `ต้องเป็น JSON ที่ parse ได้: ${line}`);
    assert.equal(line.includes('getter ระเบิด'), false, 'ข้อความของ getter ที่พังต้องไม่หลุด');
    assert.equal(line.includes('toJSON ระเบิด'), false);
  }
  const first = JSON.parse(lines[0]) as { lvl: string; event: string; error: { message: string } };
  assert.equal(first.event, 'probe.event');
  assert.equal(first.error.message, '[อ่านไม่ได้]', 'ค่าเดียวที่พังถูกแทน ไม่ทิ้งทั้งบรรทัด');
  const circularOut = JSON.parse(lines[4]) as { context: { label: string } };
  assert.equal(circularOut.context.label, 'วงกลม', 'วงกลมต้องไม่ทำให้ log หาย (ตัดที่ความลึก)');
});

test('อีเมล TLD 1 ตัวก็ถูกปิด (x@y.z) แต่ข้อความปกติไม่ถูกตัดผิด', () => {
  const cases: [string, string][] = [
    ['Key (email)=(x@y.z) already exists', 'x***@y.z'],
    ['ยิงไปที่ a@b.co ไม่ผ่าน', 'a***@b.co'],
    ['a+tag@sub.x.io', 'a***@sub.x.io'],
  ];
  for (const [input, expected] of cases) {
    const line = serializeLog('db.write_rejected', { error: new Error(input) });
    assert.equal(line.includes(expected), true, `ต้องปิดเป็น ${expected}: ${line}`);
  }

  // ข้อความไทย/ตัวเลข/URL ปกติ ต้องไม่ถูกแตะ
  const untouched = [
    'ลบรายการไม่สำเร็จ (ยอด 1,234.00 บาท)',
    'https://console.neon.tech/api/v2/projects/abc/connection_uri?pooled=true',
    'รหัส 23505 · ไฟล์ drizzle/0000_mighty_vulture.sql · @media (min-width: 40rem)',
  ];
  for (const input of untouched) {
    const parsed = JSON.parse(serializeLog('x', { detail: input })) as { detail: string };
    assert.equal(parsed.detail, input, `ห้ามดัดข้อความปกติ: ${input}`);
  }
});

test('logServer เขียนบรรทัดเดียวตามระดับ และเนื้อหาเหมือน serializeLog', () => {
  const captured: { method: string; line: string }[] = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  // แทน console ชั่วคราวเพื่อดูว่าออกทางช่องไหน + บรรทัดที่ออกต้องตรงกับ serializeLog
  console.log = (line?: unknown) => captured.push({ method: 'log', line: String(line) });
  console.warn = (line?: unknown) => captured.push({ method: 'warn', line: String(line) });
  console.error = (line?: unknown) => captured.push({ method: 'error', line: String(line) });
  try {
    logServer('db.unavailable', { level: 'info' });
    logServer('session.read_failed', { level: 'warn', route: '/settings' });
    logServer('action.save_failed', { email: SECRET_EMAIL });
  } finally {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
  }

  assert.deepEqual(
    captured.map((entry) => entry.method),
    ['log', 'warn', 'error'],
    'info→log · warn→warn · ค่าเริ่มต้น→error',
  );
  assert.equal(captured[0].line, serializeLog('db.unavailable', { level: 'info' }, new Date(JSON.parse(captured[0].line).t as string)));
  assert.equal(captured[2].line.includes(SECRET_EMAIL), false);
  assert.equal(JSON.parse(captured[2].line).email, '[ตัด: ข้อมูลส่วนตัว]');
});
