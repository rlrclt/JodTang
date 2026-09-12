import { defineConfig } from 'drizzle-kit';

/**
 * Better Auth CLI อ่านไฟล์นี้เพื่อหาว่า schema อยู่ไหน → ต้องชี้ ./src/db/schema.ts
 * migrate ใช้ DATABASE_URL_DIRECT (ต่อ Postgres ตรง) เพราะ pooled เป็น PgBouncer โหมด transaction รัน DDL ไม่ได้
 * generate ไม่ต้องต่อ DB — ใช้ได้แม้ยังไม่มี credential
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  dbCredentials: { url: process.env.DATABASE_URL_DIRECT ?? '' },
});
