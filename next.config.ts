import type { NextConfig } from "next";

/** dev ต้องผ่อน CSP บางข้อ (HMR ใช้ eval + websocket) — production ไม่ผ่อน */
const isDev = process.env.NODE_ENV === "development";

/**
 * CSP: เริ่มจากชุดเข้มสุดที่ยังทำงานได้ แล้วผ่อนเฉพาะที่พิสูจน์ว่า Next ต้องใช้
 *   - script-src 'unsafe-inline'  : Next ฝัง bootstrap/inline JSON (self.__next_f.push) ใน HTML ทุกหน้า → ถ้าไม่ให้ เพจขาว
 *   - script-src 'unsafe-eval'    : **dev เท่านั้น** — webpack HMR ใช้ eval; production build ไม่ใช้ (ไม่ผ่อน)
 *   - style-src 'unsafe-inline'   : Tailwind/Next ฉีด <style> และ component ใช้ style="" (design.md ใช้ CSS var) → ต้องมี
 *   - connect-src ws:/wss:        : **dev เท่านั้น** — websocket ของ HMR; production ต่อ same-origin พอ
 *   - img-src data: blob:         : ไอคอน/พรีวิวในไฟล์เดียว; font-src 'self' data: สำหรับ next/font ที่ self-host
 * ไม่มี nonce เพราะแอปไม่มี middleware และหน้าเป็น RSC ที่ cache ได้ — ใช้ 'unsafe-inline' ซึ่งเป็นข้อแลกเปลี่ยนที่รู้ตัว
 */
const csp = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
].join("; ");

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

  /**
   * HTTP security headers ทุกเส้นทาง (audit F1) — แอปไม่มี middleware.ts จึงตั้งที่เดียวนี้
   * HSTS ใช้ได้กับ HTTPS เท่านั้น (dev เป็น http → เบราว์เซอร์ไม่สนใจ header นี้ ไม่พัง)
   */
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
