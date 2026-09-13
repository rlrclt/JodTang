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
 *   2. DDL มาจาก drizzle/0000_mighty_vulture.sql ไฟล์เดียว (ตาราง/index/trigger ครบตาม docs/drizzle-mapping.md)
 *      apply ครั้งแรกที่เปิด DB · เช็คก่อนว่ามีตารางอยู่แล้วไหม → รันซ้ำไม่พัง
 *      และ apply ทั้งไฟล์ใน transaction เดียว → พังกลางทางต้องไม่เหลือ schema ครึ่ง ๆ กลาง ๆ
 *   3. getDb() ฝั่งแอปเป็น sync (src/lib/auth.ts เรียกตอนสร้าง instance) แต่ PGlite เปิดแบบ async
 *      → คืน drizzle instance ที่ห่อ client ไว้ แล้ว "รอความพร้อมตอนยิง query แรก" ไม่ใช่ตอนสร้าง
 *      ผู้เรียกจึงได้ Db กลับไปแบบ sync เหมือนเดิม โดยไม่ต้องแก้ src/app/** หรือ src/lib/**
 *   4. ไฟล์ DB อยู่ที่ ./.pglite (อยู่ใน .gitignore) — ข้อมูลในเครื่องเท่านั้น ห้าม commit
 *   5. PGlite เป็น postgres ใน WASM ที่อยู่ในหน่วยความจำของ process ตัวเอง → **1 data dir ต้องมี instance เดียวต่อ process**
 *      instance ที่เปิดค้างไว้ถือ snapshot ของตัวเอง ไม่มี invalidation ข้าม instance
 *      → เปิด 2 instance บน dir เดียวกัน (เช่นสอง process หรือเดิมคือหลาย module copy ใน next dev)
 *        แล้ว write ของตัวหนึ่งจะไม่ปรากฏให้อีกตัวอ่าน จนกว่าจะปิด/เปิดใหม่
 *      - ภายใน process แก้แล้วด้วย cache บน globalThis (getDevDb) — ทุก compilation layer ของ next dev ใช้ตัวเดียวกัน
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

/** migration ตัวเดียวของโปรเจกต์ (drizzle/meta/_journal.json) — DDL ครบทั้งตาราง/index/trigger */
const DDL_FILE = resolve(process.cwd(), 'drizzle', '0000_mighty_vulture.sql');

/** ตารางที่ใช้เช็คว่า DDL ถูก apply แล้วหรือยัง — ใช้ได้เพราะ DDL ถูก apply ทั้งไฟล์แบบ atomic */
const SENTINEL = 'public.transactions';

type DevDb = {
  db: Db;
  /** ปิด PGlite ให้ flush ลงดิสก์ — สคริปต์/เทสต์ที่เปิด dev DB ต้องเรียกก่อนจบ process */
  close: () => Promise<void>;
};

/**
 * cache ตัว instance ไว้บน `globalThis` ไม่ใช่ตัวแปรระดับโมดูล
 *
 * ทำไม: `next dev` โหลดไฟล์นี้หลายครั้งใน process เดียวกัน — แต่ละ compilation layer (RSC/page กับ
 * route handler/server action) มี module registry คนละชุด → ตัวแปรระดับโมดูลได้ PGlite คนละตัว
 * ทั้งที่ชี้ data dir เดียวกัน · PGlite (postgres ใน WASM) ไม่มี invalidation ข้าม instance
 * → write ที่ layer หนึ่ง อีก layer ยังอ่าน snapshot เก่าของตัวเอง (เขียนแล้วหน้าเว็บไม่เห็นจนกว่าจะรีสตาร์ท)
 * `globalThis` เป็นที่เดียวที่ทุก layer ใน process เดียวกันเห็นร่วมกัน
 */
const devDbCache = globalThis as typeof globalThis & { __jodjaiDevDb?: DevDb };

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

    let ddl: string;
    try {
      ddl = readFileSync(DDL_FILE, 'utf8');
    } catch (error) {
      throw new Error(`อ่าน DDL ไม่ได้ที่ ${DDL_FILE} — รันจาก root ของโปรเจกต์`, { cause: error });
    }
    await pg.transaction(async (tx) => {
      await tx.exec(ddl);
    });
    console.log(`[jodjai] dev DB ใหม่: apply ${DDL_FILE} แล้ว (${DEV_DB_DIR})`);
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

/** dev DB ของ process นี้ (ตัวเดียว ทุก layer ใช้ร่วมกัน) — sync เหมือน getDb() ของ Neon */
export function getDevDb(): Db {
  devDbCache.__jodjaiDevDb ??= create();
  return devDbCache.__jodjaiDevDb.db;
}

/**
 * ปิด dev DB (flush ลงดิสก์) — เรียกจากสคริปต์/เทสต์เท่านั้น
 * ไม่มี dev DB เปิดอยู่ = ไม่ทำอะไร (สคริปต์ที่รันแต่โหมด Neon เรียกได้โดยไม่พัง)
 */
export async function closeDevDb(): Promise<void> {
  const open = devDbCache.__jodjaiDevDb;
  devDbCache.__jodjaiDevDb = undefined;
  await open?.close();
}
