/**
 * เทสต์ตัวเลือกของ dev DB (PGlite) — cache ต้องผูกกับ data dir ไม่ใช่มี instance เดียวลอย ๆ
 * รัน: node --test src/db/dev-pglite.test.ts
 *
 * ทำไมต้องมี: `next dev` โหลดโมดูลนี้ได้หลายครั้งใน process เดียว (คนละ compilation layer) และแต่ละครั้ง
 * อ่าน `PGLITE_DIR`/cwd ได้คนละค่า → cache ที่ไม่สนใจ dir จะหยิบ instance ของโฟลเดอร์อื่นมาใช้เงียบ ๆ
 * (อ่าน/เขียนผิดที่โดยไม่มี error) · เทสต์นี้จำลองด้วยการ import โมดูล 2 ครั้งโดยสลับ `PGLITE_DIR` ระหว่างนั้น
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

/** อ่านชื่อ index ของ transactions จาก data dir (เปิด PGlite ตัวใหม่ — เรียกหลังปิด dev DB แล้วเท่านั้น) */
async function pgliteFromDir(dir: string): Promise<string[]> {
  const pg = new PGlite(dir);
  await pg.waitReady;
  const rows = await pg.query<{ indexname: string }>(
    "select indexname from pg_indexes where tablename = 'transactions' order by 1",
  );
  await pg.close();
  return rows.rows.map((row) => row.indexname);
}

const dirA = mkdtempSync(join(tmpdir(), 'jj-devdb-a-'));
const dirB = mkdtempSync(join(tmpdir(), 'jj-devdb-b-'));
const originalDir = process.env.PGLITE_DIR;

test('cache ของ dev DB ผูกกับ data dir: dir เดิม = instance เดียว · คนละ dir = คนละ instance', async () => {
  try {
    // โมดูลที่ 1 — เหมือน registry แรกของ next dev ที่อ่าน PGLITE_DIR = dirA
    // (ใช้ dynamic import โดยตั้งใจ: เทสต์นี้ต้อง "ประเมินโมดูลใหม่" หลังสลับ env — static import ทำไม่ได้)
    process.env.PGLITE_DIR = dirA;
    const modA = await import('./dev-pglite.ts');
    assert.equal(modA.DEV_DB_DIR, dirA, 'DEV_DB_DIR ต้องอ่านจาก env ตอนโมดูลถูกโหลด');

    const first = modA.getDevDb();
    assert.equal(modA.getDevDb(), first, 'dir เดิม ต้องได้ instance เดิม (1 process = 1 instance ต่อ dir)');

    // โมดูลที่ 2 — registry ที่สอง (คนละ specifier = ประเมินโมดูลใหม่) อ่าน PGLITE_DIR = dirB
    // ใช้ตัวแปรเป็น specifier เพื่อให้ TS ไม่พยายาม resolve path ที่มี query string (?copy=b) ตอน type-check
    process.env.PGLITE_DIR = dirB;
    const secondCopy = './dev-pglite.ts?copy=b';
    const modB: typeof modA = await import(secondCopy);
    assert.equal(modB.DEV_DB_DIR, dirB);

    const second = modB.getDevDb();
    assert.notEqual(second, first, 'คนละ dir ต้องได้คนละ instance');
    assert.equal(modB.getDevDb(), second, 'dir B เรียกซ้ำก็ยังได้ตัวเดิม');
    assert.equal(modA.getDevDb(), first, 'โมดูล A ต้องไม่ถูกเปลี่ยนไปใช้ instance ของ dir B');

    // ปิดทั้งหมด: closeDevDb ล้างทุก key (ไม่ใช่แค่ dir ของผู้เรียก)
    await modA.closeDevDb();
    const afterClose = modA.getDevDb();
    assert.notEqual(afterClose, first, 'หลัง closeDevDb ต้องได้ instance ใหม่ (ตัวเก่าถูกปิดไปแล้ว)');
    assert.equal(modA.getDevDb(), afterClose, 'ตัวใหม่ก็ยัง cache อยู่');

    await modA.closeDevDb();
  } finally {
    if (originalDir === undefined) delete process.env.PGLITE_DIR;
    else process.env.PGLITE_DIR = originalDir;
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test('migrationFilesFrom: อ่านรายชื่อจาก journal ตามลำดับ (ไม่ hardcode ไฟล์) + กัน journal เพี้ยน', async () => {
  const { migrationFilesFrom } = await import('./dev-pglite.ts');

  // journal ปลอม: ต้องได้ไฟล์ตามลำดับที่ให้มา (พิสูจน์ว่าโค้ดไม่ผูกกับ 0000 ตัวเดียว)
  const fake = {
    version: '7',
    entries: [{ tag: '0000_first' }, { tag: '0001_second' }, { tag: '0002_third' }],
  };
  assert.deepEqual(migrationFilesFrom(fake, '/x/drizzle'), [
    '/x/drizzle/0000_first.sql',
    '/x/drizzle/0001_second.sql',
    '/x/drizzle/0002_third.sql',
  ]);

  // entry ที่ไม่มี tag / ไม่ใช่ string ถูกข้าม ไม่ทำให้ทั้งชุดพัง
  assert.deepEqual(migrationFilesFrom({ entries: [{ tag: '0000_only' }, {}, { tag: 7 }] }, '/y'), [
    '/y/0000_only.sql',
  ]);

  // journal ที่ใช้ไม่ได้ → ล้มเสียงดัง (ไม่เงียบ ๆ ปล่อย dev DB ว่าง schema)
  for (const bad of [null, {}, { entries: [] }, { entries: 'nope' }]) {
    assert.throws(() => migrationFilesFrom(bad, '/z'), /ไม่พบรายการ migration/);
  }
});

test('dev DB ใหม่ได้ schema ครบทุก migration (index ของ transactions ครบ 8 รวมของถังขยะ)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jj-devdb-migrations-'));
  const previous = process.env.PGLITE_DIR;
  try {
    process.env.PGLITE_DIR = dir;
    // คนละ specifier = ประเมินโมดูลใหม่ (จำลอง dev server ที่เพิ่งเปิด แล้วเจอ dir เปล่า)
    // ใช้ตัวแปรเป็น specifier เพื่อให้ TS ไม่พยายาม resolve path ที่มี query string ตอน type-check
    const freshCopy = './dev-pglite.ts?migrations=1';
    const mod: typeof import('./dev-pglite.ts') = await import(freshCopy);
    const db = mod.getDevDb();

    // ยิง query จริงหนึ่งครั้งเพื่อให้ DDL ถูก apply
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`select 1`);

    const indexes = await pgliteFromDir(dir).then((pg) => pg);
    assert.ok(indexes.includes('transactions_user_deleted_idx'), `ต้องมี index ของถังขยะ (ได้ ${indexes.join(', ')})`);
    assert.equal(indexes.length, 8, `transactions ต้องมี 8 index (ได้ ${indexes.length}: ${indexes.join(', ')})`);
    await mod.closeDevDb();
  } finally {
    if (previous === undefined) delete process.env.PGLITE_DIR;
    else process.env.PGLITE_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
