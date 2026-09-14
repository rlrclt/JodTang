import { bangkokDateValue } from '@/components/entry-view';
import { getDb } from '@/db';
import { assertExportWithinCap, countExportRows, exportTransactionRows, MAX_EXPORT_ROWS } from '@/db/queries/export';
import type { KeysetCursor } from '@/db/queries/transactions';
import { toCsv } from '@/lib/export-format';
import { monthScopeFromParam } from '@/lib/month-url';
import { isNextControlFlow } from '@/lib/next-signals';
import { getSession } from '@/lib/session';
import { logServer } from '@/lib/log';

/**
 * GET /export/transactions — ดาวน์โหลดรายการทั้งหมดเป็น CSV (wave27 · local://wave27-design.md)
 *
 * ⛔ กติกา:
 * - **session เท่านั้น** — userId ไม่รับจากพารามิเตอร์ใด ๆ · ไม่ล็อกอิน = **401** (ไม่ redirect ไป /login
 *   เพราะเบราว์เซอร์จะดาวน์โหลดหน้า HTML มาเป็นไฟล์)
 * - **ไม่รวมรายการที่ลบแล้ว** (ผู้ใช้กู้คืนได้ที่ ตั้งค่า › รายการที่ลบแล้ว)
 * - เกินเพดาน → ข้อความไทย ไม่ใช่ไฟล์ครึ่งเดียว (ไฟล์ที่ถูกตัดครึ่งแยกไม่ออกจากไฟล์สมบูรณ์)
 * - ตัวไฟล์ (BOM/CRLF/escape/หัวตาราง) อยู่ใน `toCsv()` ที่ชั้นข้อมูล — route นี้ไม่ประกอบเอง
 * - `?m=` optional: ไม่ส่ง/`all` = ทุกเดือน · ค่าที่เป็นเดือน = เฉพาะเดือนนั้น (ค่าขยะ = ไม่ 500)
 */

/** ต้องมี session/อ่าน DB ทุกครั้ง — ห้าม prerender ตอน build (ไม่มีคุกกี้/ไม่มีผู้ใช้) */
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

export async function GET(request: Request): Promise<Response> {
  let session;
  try {
    session = await getSession();
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    // DB ล่ม/ตรวจ session ไม่ได้ — บอกตรง ๆ เป็นข้อความ ไม่ใช่ไฟล์เปล่าที่ดูเหมือนสำเร็จ
    logServer('session.read_failed', { error, route: '/export/transactions' });
    return errorResponse(503, 'ฐานข้อมูลไม่ตอบสนองตอนนี้ — ลองใหม่ภายหลัง');
  }
  if (!session) return errorResponse(401, 'ต้องเข้าสู่ระบบก่อนส่งออกข้อมูล');

  const raw = new URL(request.url).searchParams.get('m');
  // ไม่ส่ง ?m= เลย = ทุกเดือน (ต่างจากหน้าจอที่ "ไม่ส่ง" = เดือนปัจจุบัน) · 'all' ก็คือทุกเดือน
  const periodMonth = raw === null || raw === 'all' ? undefined : monthScopeFromParam(raw);

  try {
    const db = getDb();
    // 1) นับก่อน → เกินเพดาน = ข้อความไทย ไม่เริ่มสร้างไฟล์ (กันไฟล์ครึ่งเดียว)
    const total = await countExportRows(db, session.userId, { periodMonth });
    try {
      assertExportWithinCap(total);
    } catch {
      return errorResponse(
        413,
        `รายการที่จะส่งออกมี ${total.toLocaleString('th-TH')} แถว เกินเพดาน ${MAX_EXPORT_ROWS.toLocaleString('th-TH')} แถวต่อครั้ง — กรองให้แคบลงก่อน (เช่นส่งออกเป็นเดือน) แล้วลองใหม่`,
      );
    }

    // 2) ดึงด้วย keyset หน้าเดิม ๆ จนครบ (เพดานถูกตรวจแล้วด้านบน)
    const rows = [];
    let cursor: KeysetCursor | undefined;
    for (;;) {
      const page = await exportTransactionRows(db, session.userId, { periodMonth, cursor });
      rows.push(...page.rows);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    const csv = toCsv(rows);
    const filename = `jodjai-transactions-${bangkokDateValue(new Date())}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    logServer('export.csv_failed', { error, route: '/export/transactions' });
    return errorResponse(503, 'ส่งออกไม่สำเร็จตอนนี้ — ลองใหม่ภายหลัง');
  }
}
