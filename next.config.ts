import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * PGlite เป็น WASM + อ่านไฟล์ .wasm/.data ของตัวเองด้วย path ตอน runtime
   * ถ้าให้ bundler ของ Next แตะ มันจะพังตอน init (TypeError: The "path" argument must be of type string
   * or an instance of Buffer or URL. Received an instance of URL) → ทุกคำขอที่แตะ DB ตาย 500
   *
   * เกี่ยวข้องกับ: dev fallback เมื่อไม่มี DATABASE_URL (src/db/dev-pglite.ts) และเทสต์ PGlite (node --test)
   * เส้น Neon จริงไม่ใช้แพ็กเกจนี้ → ต้องเป็น external เท่านั้น (แพ็กเกจเดียว ไม่เหวี่ยงใส่ทั้ง node_modules)
   */
  serverExternalPackages: ['@electric-sql/pglite'],
};

export default nextConfig;
