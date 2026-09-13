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
