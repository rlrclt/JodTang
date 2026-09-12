import { toNextJsHandler } from 'better-auth/next-js';

import { getAuth } from '@/lib/auth';

// callback ที่ต้องไปกรอกในคอนโซลผู้ให้บริการ (dev): /api/auth/callback/google · /api/auth/callback/line
// ส่งเป็นฟังก์ชัน (ไม่ใช่ instance) เพื่อให้ better-auth ถูกสร้างตอน request แรก → `next build` ไม่ต้องมี credential
export const { GET, POST } = toNextJsHandler((request) => getAuth().handler(request));
