import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from './schema';

/**
 * ตัวแอปต่อผ่าน Neon pooled URL (DATABASE_URL) เท่านั้น — pooled = PgBouncer โหมด transaction
 * ห้ามใช้ DATABASE_URL_DIRECT ในแอป (จะกิน connection หมด) · migrate ใช้ direct (drizzle.config.ts)
 * อ่านจาก env เท่านั้น ไม่มี fallback ในโค้ด — ลืมตั้ง env ต้องล้มทันที ไม่ใช่ต่อผิด DB เงียบ ๆ
 *
 * เป็นฟังก์ชัน ไม่ใช่ const ตอน import เพราะ `next build` โหลดโมดูลของ route ตอนเก็บ page data
 * → ถ้าต่อ DB ตอน import ตัว build จะล้มบนเครื่องที่ยังไม่มี credential (lazy = ล้มตอน query แรกแทน)
 */
function build() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL ไม่ได้ตั้งไว้ (ดูรายชื่อ env ทั้งหมดใน .env.example)');
  }
  return drizzle(neon(url), { schema });
}

type Db = ReturnType<typeof build>;

/** ชนิดของ drizzle instance ที่แอปใช้ (neon-http) — ผู้ใช้ส่งเป็นพารามิเตอร์เพื่อให้เทสต์สลับ driver ได้ */
export type { Db };

let cached: Db | undefined;

export function getDb(): Db {
  cached ??= build();
  return cached;
}

export { schema };
