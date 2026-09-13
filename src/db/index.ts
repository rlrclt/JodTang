import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';

import { getDevDb } from './dev-pglite.ts';
import * as schema from './schema';

/**
 * ชนิดของ drizzle instance ที่แอปใช้ (neon-http) — ผู้ใช้ส่งเป็นพารามิเตอร์เพื่อให้เทสต์/dev สลับ driver ได้
 * เขียนตรง ๆ ไม่ใช้ ReturnType<typeof build> เพราะ build() คืน Db ของ dev fallback ด้วย = ชนิดอ้างตัวเองไม่จบ
 */
type Db = NeonHttpDatabase<typeof schema>;

/**
 * ตัวแอปต่อผ่าน Neon pooled URL (DATABASE_URL) เท่านั้น — pooled = PgBouncer โหมด transaction
 * ห้ามใช้ DATABASE_URL_DIRECT ในแอป (จะกิน connection หมด) · migrate ใช้ direct (drizzle.config.ts)
 *
 * มี DATABASE_URL = Neon เส้นทางเดิมเสมอ (ไม่ว่า NODE_ENV เป็นอะไร) — ห้ามเปลี่ยนพฤติกรรมนี้
 * ไม่มี DATABASE_URL:
 *   - NODE_ENV === 'production' → ล้มทันทีเหมือนเดิม (ไม่ต่อผิด DB เงียบ ๆ)
 *   - ไม่งั้น (dev/test) → PGlite แบบมีไฟล์ที่ ./.pglite (src/db/dev-pglite.ts)
 *     เพื่อให้คนที่ยังไม่มี credential ของ Neon รันแอปได้ — ไม่ต้องแก้ src/app/** หรือ src/lib/**
 *
 * เป็นฟังก์ชัน ไม่ใช่ const ตอน import เพราะ `next build` โหลดโมดูลของ route ตอนเก็บ page data
 * → ถ้าต่อ DB ตอน import ตัว build จะล้มบนเครื่องที่ยังไม่มี credential (lazy = ล้มตอน query แรกแทน)
 */
function build(): Db {
  const url = process.env.DATABASE_URL;
  if (url) return drizzle(neon(url), { schema });

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL ไม่ได้ตั้งไว้ (ดูรายชื่อ env ทั้งหมดใน .env.example)');
  }
  return getDevDb();
}

export type { Db };

let cached: Db | undefined;

export function getDb(): Db {
  cached ??= build();
  return cached;
}

export { schema };
