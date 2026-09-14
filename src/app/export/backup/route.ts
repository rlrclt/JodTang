import { bangkokDateValue } from '@/components/entry-view';
import { getDb } from '@/db';
import { ValidationError } from '@/db/errors';
import { buildBackupSnapshot } from '@/db/queries/export';
import { toJson } from '@/lib/export-format';
import { isNextControlFlow } from '@/lib/next-signals';
import { getSession } from '@/lib/session';
import { logServer } from '@/lib/log';

/**
 * GET /export/backup — สำรองข้อมูลทั้งบัญชีเป็น JSON (wave27 · local://wave27-design.md)
 *
 * - snapshot ครบชุดเสมอ (กระเป๋า · หมวดรวมที่ archive · งบทุกเดือน · รายการที่ยังไม่ถูกลบ) — **ไม่รับ `?m=`**
 * - `buildBackupSnapshot` โยน ValidationError ข้อความไทยเมื่อเกินเพดาน 20,000 ⇒ ไม่มีไฟล์ครึ่งเดียว
 * - session เท่านั้น · ไม่ล็อกอิน = 401 (ไม่ redirect) · no-store + nosniff + Content-Disposition แนบไฟล์
 */

export const dynamic = 'force-dynamic';

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function GET(): Promise<Response> {
  let session;
  try {
    session = await getSession();
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    logServer('session.read_failed', { error, route: '/export/backup' });
    return errorResponse(503, 'ฐานข้อมูลไม่ตอบสนองตอนนี้ — ลองใหม่ภายหลัง');
  }
  if (!session) return errorResponse(401, 'ต้องเข้าสู่ระบบก่อนส่งออกข้อมูล');

  try {
    const snapshot = await buildBackupSnapshot(getDb(), session.userId);
    const json = toJson(snapshot);
    const filename = `jodjai-backup-${bangkokDateValue(new Date())}.json`;
    return new Response(json, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    // ValidationError (เพดาน) = ความผิดของผู้ใช้ ไม่ใช่เซิร์ฟเวอร์พัง → 413 + ข้อความไทยจากชั้นข้อมูล
    if (error instanceof ValidationError) return errorResponse(413, error.message);
    logServer('export.backup_failed', { error, route: '/export/backup' });
    return errorResponse(503, 'ส่งออกไม่สำเร็จตอนนี้ — ลองใหม่ภายหลัง');
  }
}
