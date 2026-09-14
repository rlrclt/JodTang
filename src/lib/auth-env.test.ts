/**
 * เทสต์ด่านตรวจ env ของ Better Auth (audit F3) — pure function ไม่ต้องมี DB
 * รัน: node --test src/lib/auth-env.test.ts
 *
 * กติกา: production ที่ BETTER_AUTH_URL ว่างหรือไม่ใช่ https → ล้มทันที (cookie จะไม่ถูกตั้ง Secure)
 *        dev/test → ไม่ล้ม (http://localhost ใช้ตามปกติ)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertProductionAuthUrl, isInvalidProductionAuthUrl } from './auth-env.ts';

test('production ที่ BETTER_AUTH_URL ว่าง/ไม่ใช่ https → โยน Error ข้อความไทย', () => {
  for (const bad of [undefined, '', 'http://jodjai.example.com', 'jodjai.example.com', 'ftp://x']) {
    assert.equal(isInvalidProductionAuthUrl('production', bad), true, `ต้องถือว่าผิด: ${String(bad)}`);
    assert.throws(
      () => assertProductionAuthUrl('production', bad),
      (error: unknown) =>
        error instanceof Error && /BETTER_AUTH_URL ต้องเป็น https:\/\//.test(error.message),
    );
  }
});

test('production ที่เป็น https → ผ่าน', () => {
  assert.equal(isInvalidProductionAuthUrl('production', 'https://jodjai.example.com'), false);
  assert.doesNotThrow(() => assertProductionAuthUrl('production', 'https://jodjai.example.com'));
});

test('dev/test ไม่ถูกบังคับ (http://localhost ใช้ได้) — และค่าว่างก็ไม่ล้ม', () => {
  for (const env of ['development', 'test', undefined]) {
    assert.equal(isInvalidProductionAuthUrl(env, 'http://localhost:3000'), false, String(env));
    assert.doesNotThrow(() => assertProductionAuthUrl(env, 'http://localhost:3000', undefined));
    assert.doesNotThrow(() => assertProductionAuthUrl(env, undefined, undefined), 'dev ที่ยังไม่ตั้ง env ต้องไม่ล้ม');
  }
});

test('ช่วง `next build` (phase-production-build) ไม่ล้ม — แต่ production จริงยังล้ม', () => {
  assert.doesNotThrow(
    () => assertProductionAuthUrl('production', 'http://localhost:3000', 'phase-production-build'),
    'ตอน build ยังไม่เสิร์ฟ traffic · ถ้าล้มตรงนี้หน้าเว็บจะถูกจัดเป็น static (หลอกตา)',
  );
  assert.throws(
    () => assertProductionAuthUrl('production', 'http://localhost:3000', 'phase-production-server'),
    /BETTER_AUTH_URL ต้องเป็น https:\/\//,
    'production runtime ต้องยังล้ม',
  );
});
