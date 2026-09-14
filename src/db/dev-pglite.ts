/**
 * DB สำหรับ dev บนเครื่องที่ยังไม่มี credential ของ Neon — dev fallback ของ src/db/index.ts
 *
 * ทำไมมีไฟล์นี้: เทสต์ของ src/db/** ใช้ PGlite อยู่แล้ว แต่ตัวแอป (`npm run dev`) ต้องมี Neon
 * → คนที่เพิ่ง clone รันแอปไม่ได้เลยจนกว่าจะทำ docs/SETUP.md ครบ (30-45 นาที)
 * ไฟล์นี้ต่อ PGlite แบบมีไฟล์ (persistent) ให้ทั้งแอปวิ่งบน Postgres ในเครื่องได้
 *
 * กติกา:
 *   1. ใช้เมื่อ "ไม่มี DATABASE_URL และ NODE_ENV !== 'production'" เท่านั้น — index.ts เป็นคนตัดสิน
 *      ห้ามให้ไฟล์นี้ตัดสินเอง ไม่งั้น production ที่มี DATABASE_URL อาจหลุดมาใช้ PGlite
 *   2. schema มาจาก **migration ทุกไฟล์ตาม journal** (drizzle/meta/_journal.json → drizzle/*.sql เรียงตามลำดับ
 *      ไม่ hardcode ชื่อไฟล์) · apply ครั้งแรกที่เปิด DB · เช็คก่อนว่ามีตารางอยู่แล้วไหม → รันซ้ำไม่พัง
 *      และ apply ทั้งชุดใน transaction เดียว → พังกลางทางต้องไม่เหลือ schema ครึ่ง ๆ กลาง ๆ
 *      (ไดเรกทอรี .pglite ที่สร้างไว้ก่อนมี migration ใหม่จะยังเป็น schema เก่า — ลบทิ้งเพื่อให้สร้างใหม่)
 *   3. getDb() ฝั่งแอปเป็น sync (src/lib/auth.ts เรียกตอนสร้าง instance) แต่ PGlite เปิดแบบ async
 *      → คืน drizzle instance ที่ห่อ client ไว้ แล้ว "รอความพร้อมตอนยิง query แรก" ไม่ใช่ตอนสร้าง
 *      ผู้เรียกจึงได้ Db กลับไปแบบ sync เหมือนเดิม โดยไม่ต้องแก้ src/app/** หรือ src/lib/**
 *   4. ไฟล์ DB อยู่ที่ ./.pglite (อยู่ใน .gitignore) — ข้อมูลในเครื่องเท่านั้น ห้าม commit
 *   5. PGlite เป็น postgres ใน WASM ที่อยู่ในหน่วยความจำของ process ตัวเอง → **1 data dir ต้องมี instance เดียวต่อ process**
 *      cache อยู่บน globalThis และ **key = DEV_DB_DIR** (โมดูลถูกโหลดซ้ำได้หลาย registry ใน next dev)
 *      - dir เดียวกัน ⇒ instance เดียวเสมอ · คนละ dir ⇒ คนละ instance (ไม่หยิบข้ามโฟลเดอร์)
 *      - `DEV_DB_DIR` อ่านจาก `PGLITE_DIR`/cwd ตอนโมดูลถูกโหลด (ครั้งเดียวต่อ registry) — ตั้ง env ก่อนเปิด process
 *      - `closeDevDb()` ปิดและล้างทุก dir ใน process
 *      - ข้าม process **ยังไม่มี lock**: อย่ารัน `next dev` สองตัว (หรือ dev + สคริปต์) ชี้ PGLITE_DIR เดียวกันพร้อมกัน
 *        ถ้าจำเป็นให้ตั้ง PGLITE_DIR คนละโฟลเดอร์ · และถ้าต้องทดสอบ write flow ให้ใช้ Neon (docs/SETUP.md)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { Db } from './index.ts';
import * as schema from './schema.ts';

/** โฟลเดอร์ข้อมูลของ PGlite — ทับได้ด้วย PGLITE_DIR (เช่นชี้ไปที่อื่นที่ไม่ถูก watch) */
export const DEV_DB_DIR = process.env.PGLITE_DIR ?? resolve(process.cwd(), '.pglite');

/** โฟลเดอร์ migration ของโปรเจกต์ (drizzle-kit) — รายชื่อไฟล์อ่านจาก journal ไม่ได้ hardcode */
const MIGRATIONS_DIR = resolve(process.cwd(), 'drizzle');
/** journal ของ drizzle-kit = แหล่งความจริงว่ามี migration ไฟล์อะไรบ้างและลำดับไหน */
const JOURNAL_FILE = resolve(MIGRATIONS_DIR, 'meta', '_journal.json');

/**
 * รายชื่อไฟล์ migration **ตามลำดับใน journal** (path เต็ม)
 * pure function: รับ JSON ที่ parse แล้ว + โฟลเดอร์ → เทสต์ได้โดยไม่ต้องมีไฟล์จริง
 * ทำไมต้องอ่าน journal: dev DB ต้องได้ schema ชุดเดียวกับ production — ถ้า hardcode ไฟล์เดียว
 * migration ถัดไป (เช่นเพิ่มคอลัมน์) จะไม่ถูก apply บนเครื่อง dev แล้วพังเงียบ ๆ ตอนรันแอป
 */
export function migrationFilesFrom(journal: unknown, dir: string): string[] {
  // อ่านแบบ narrow ทีละชั้น (ไม่ cast ทับ) — journal เป็นไฟล์ที่คนอื่น generate จึงไม่เชื่อรูปทรงล่วงหน้า
  const entries: unknown = journal && typeof journal === 'object' && 'entries' in journal ? journal.entries : undefined;
  const tags = (Array.isArray(entries) ? entries : [])
    .map((entry) => (entry && typeof entry === 'object' && 'tag' in entry ? entry.tag : undefined))
    .filter((tag): tag is string => typeof tag === 'string' && tag !== '');

  if (tags.length === 0) {
    throw new Error(`ไม่พบรายการ migration ใน journal (${JOURNAL_FILE}) — ไฟล์อาจว่างหรือถูกย้าย`);
  }
  return tags.map((tag) => resolve(dir, `${tag}.sql`));
}

/** ตารางที่ใช้เช็คว่า schema ถูก apply แล้วหรือยัง — ใช้ได้เพราะ apply ทั้งชุดใน transaction เดียว */
const SENTINEL = 'public.transactions';

type DevDb = {
  db: Db;
  /** ปิด PGlite ให้ flush ลงดิสก์ — สคริปต์/เทสต์ที่เปิด dev DB ต้องเรียกก่อนจบ process */
  close: () => Promise<void>;
};

/**
 * cache ตัว instance ไว้บน `globalThis` ไม่ใช่ตัวแปรระดับโมดูล — และ **key คือ data dir**
 *
 * ทำไมต้อง globalThis: `next dev` โหลดไฟล์นี้หลายครั้งใน process เดียวกัน — แต่ละ compilation layer
 * (RSC/page กับ route handler/server action) มี module registry คนละชุด → ตัวแปรระดับโมดูลได้ PGlite
 * คนละตัวทั้งที่ชี้ data dir เดียวกัน · PGlite (postgres ใน WASM) ไม่มี invalidation ข้าม instance
 * → write ที่ layer หนึ่ง อีก layer ยังอ่าน snapshot เก่าของตัวเอง (เขียนแล้วหน้าเว็บไม่เห็นจนกว่าจะรีสตาร์ท)
 *
 * ทำไมต้อง key ด้วย dir: โมดูลที่ถูกโหลดซ้ำสองครั้งอ่าน `PGLITE_DIR`/cwd ได้คนละค่า → ถ้า cache ไม่สนใจ dir
 * ตัวที่สองจะหยิบ instance ของ dir แรกไปใช้ = อ่าน/เขียนผิดโฟลเดอร์โดยไม่มี error (รีวิว wave5 park ไว้)
 * key เดียวกัน ⇒ ได้ตัวเดิม (1 process = 1 instance ต่อ dir) · คนละ key ⇒ คนละ instance
 */
const devDbCache = globalThis as typeof globalThis & { __jodjaiDevDb?: Map<string, DevDb> };

/** map ของ process นี้ (สร้างครั้งแรกที่ใช้) — key = `DEV_DB_DIR` ที่โมดูลนี้ resolve ได้ */
function devDbCacheMap(): Map<string, DevDb> {
  devDbCache.__jodjaiDevDb ??= new Map();
  return devDbCache.__jodjaiDevDb;
}

/** สร้าง PGlite + drizzle ที่รอความพร้อมเอง (ดูหมายเหตุ 3 หัวไฟล์) */
function create(): DevDb {
  const pg = new PGlite(DEV_DB_DIR);
  console.log(`[jodjai] dev DB: เปิด PGlite 1 ตัวต่อ process (pid=${process.pid} dir=${DEV_DB_DIR})`);

  /** memo: รันครั้งเดียวต่อ process · ถ้าพังจะพังทุก query ด้วย error เดิม (ไม่กลืนแล้วไปต่อ) */
  const ready = (async () => {
    await pg.waitReady;

    const found = await pg.query<{ present: boolean }>(
      `select to_regclass('${SENTINEL}') is not null as present`,
    );
    if (found.rows[0]?.present) return;

    let files: string[];
    let statements: string[];
    try {
      files = migrationFilesFrom(JSON.parse(readFileSync(JOURNAL_FILE, 'utf8')), MIGRATIONS_DIR);
      // อ่านทุกไฟล์ก่อน แล้วค่อยเริ่ม transaction → ไฟล์หาย/อ่านไม่ได้ต้องไม่ทิ้ง schema ครึ่งทาง
      statements = files.map((file) => readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`อ่าน migration จาก ${MIGRATIONS_DIR} ไม่ได้ — รันจาก root ของโปรเจกต์`, { cause: error });
    }

    await pg.transaction(async (tx) => {
      for (const sql of statements) await tx.exec(sql);
    });
    console.log(
      `[jodjai] dev DB ใหม่: apply ${files.length} migration (${files.map((file) => file.split('/').pop()).join(', ')}) แล้ว (${DEV_DB_DIR})`,
    );
  })();
  // ถ้า init/DDL พังก่อนมี query แรก ต้องไม่กลายเป็น unhandled rejection ที่ฆ่า process เงียบ ๆ
  // (ตัว promise ยัง reject เหมือนเดิม — คนที่ await ready ทีหลังยังเห็น error ตัวจริง)
  ready.catch(() => {});

  // PGlite เปิดแบบ async แต่ getDb() ของแอปเป็น sync → ห่อ client ให้รอ ready ตอน query
  // เมธอดที่ drizzle-orm/pglite เรียกใช้มี 2 ตัว (query · transaction) — exec เปิดไว้ให้สคริปต์เก็บกวาดข้อมูล
  const client = {
    query: async (query: string, params?: unknown[], options?: unknown) => {
      await ready;
      return pg.query(query, params as never, options as never);
    },
    exec: async (query: string, options?: unknown) => {
      await ready;
      return pg.exec(query, options as never);
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      await ready;
      return pg.transaction(fn as never);
    },
  };

  // ส่ง client ทาง config form (ไม่ใช่ positional) เพื่อไม่ให้ drizzle ตีความ object ของเราเป็น connection string
  const db = drizzle({ client: client as unknown as PGlite, schema }) as unknown as Db;

  return {
    db,
    close: async () => {
      await ready;
      await pg.close();
    },
  };
}

/** dev DB ของ process นี้ (1 instance ต่อ data dir ทุก layer ใช้ร่วมกัน) — sync เหมือน getDb() ของ Neon */
export function getDevDb(): Db {
  const cache = devDbCacheMap();
  const open = cache.get(DEV_DB_DIR);
  if (open) return open.db;

  const created = create();
  cache.set(DEV_DB_DIR, created);
  return created.db;
}

/**
 * ปิด dev DB ทุก dir ที่ process นี้เปิดไว้ (flush ลงดิสก์) — เรียกจากสคริปต์/เทสต์เท่านั้น
 * ล้าง "ทุก key" ไม่ใช่แค่ dir ของผู้เรียก: ปิดแล้วตัวถัดไปที่เรียก getDevDb() จะได้ instance ใหม่สะอาด
 * ไม่มี dev DB เปิดอยู่ = ไม่ทำอะไร (สคริปต์ที่รันแต่โหมด Neon เรียกได้โดยไม่พัง)
 */
export async function closeDevDb(): Promise<void> {
  const cache = devDbCacheMap();
  const open = [...cache.values()];
  cache.clear();
  await Promise.all(open.map((entry) => entry.close()));
}
