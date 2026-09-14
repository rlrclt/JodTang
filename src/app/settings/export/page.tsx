import Link from 'next/link';

import { LoadFailed } from '@/components/LoadFailed';
import { bangkokDateValue } from '@/components/entry-view';
import { MAX_EXPORT_ROWS } from '@/db/queries/export';
import { gateSession } from '@/lib/session';

export const metadata = { title: 'ส่งออกข้อมูล · จดจ่าย' };

/** เพดานแถวต่อครั้ง — อ่านจากชั้นข้อมูลตัวเดียว (ห้าม hardcode ซ้ำแล้วเพี้ยนกันภายหลัง) */
const EXPORT_ROW_LIMIT = MAX_EXPORT_ROWS.toLocaleString('th-TH');

/**
 * S6/ส่งออกข้อมูล (wave27 · local://wave27-design.md)
 *
 * อธิบายก่อนให้ดาวน์โหลด — ผู้ใช้ต้องรู้ว่าได้อะไรก่อนกด (ไม่ยิงดาวน์โหลดทันทีจากแถวในหน้าตั้งค่า)
 * ไฟล์: CSV (อ่านในชีต) · JSON (สำรอง/ย้ายข้อมูล) · ทั้งคู่ **ไม่รวมรายการที่ลบแล้ว** (อยู่ในถังขยะ)
 */
export default async function ExportPage() {
  const gate = await gateSession();
  if (gate.unavailable) return <LoadFailed />;

  // ชื่อไฟล์ที่ผู้ใช้จะได้จริง (ค.ศ. ISO) — คำนวณวันนี้ตามเวลาไทย; ค่าที่ route ใช้ต้องตรงกับที่เขียนไว้ตรงนี้
  const today = bangkokDateValue(new Date());
  const csvName = `jodjai-transactions-${today}.csv`;
  const jsonName = `jodjai-backup-${today}.json`;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex min-h-11 items-center gap-1">
        <Link
          href="/settings"
          aria-label="กลับไปหน้าตั้งค่า"
          className="flex size-11 shrink-0 items-center justify-center rounded-input text-text-muted"
        >
          <svg className="size-5" aria-hidden="true">
            <use href="#i-chevron-left" />
          </svg>
        </Link>
        <h1 className="text-2xl font-semibold">ส่งออกข้อมูล</h1>
      </header>

      <section aria-labelledby="export-what-label" className="flex flex-col gap-2">
        <h2 id="export-what-label" className="text-xl font-semibold">
          ได้อะไรในไฟล์
        </h2>
        <ul className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 text-[13px] leading-[18px] text-text-muted">
          <li>
            <span className="font-semibold text-text">CSV</span> — รายการทั้งหมดที่ยังไม่ถูกลบ พร้อมชื่อหมวด/กระเป๋า/ปลายทาง
            (เปิดใน Excel หรือ Google Sheets ได้เลย) · จำนวนเงินมีทั้งสตางค์ (จำนวนเต็ม) และบาท (ทศนิยม 2 ตำแหน่ง)
          </li>
          <li>
            <span className="font-semibold text-text">JSON</span> — สำรองข้อมูลชุดเต็ม: กระเป๋า หมวด งบ และรายการ
            (ไว้ย้ายข้อมูล/สำรอง ไม่ได้ออกแบบให้อ่านด้วยตา)
          </li>
          <li>
            <span className="font-semibold text-text">ไม่รวมรายการที่ลบแล้ว</span> — รายการที่ลบอยู่ใน ตั้งค่า › รายการที่ลบแล้ว
            และกู้คืนได้ตลอด
          </li>
          <li>
            สูงสุดครั้งละ {EXPORT_ROW_LIMIT} รายการ — ถ้าเกิน ระบบจะบอกให้แคบช่วงก่อน (ไฟล์จะไม่ถูกตัดครึ่ง)
          </li>
          <li>ครั้งแรกของวันอาจใช้เวลาราว 10 วินาที (ฐานข้อมูลตื่นจากโหมดพัก) หลังจากนั้นจะเร็วขึ้น</li>
        </ul>
      </section>

      <section aria-labelledby="export-files-label" className="flex flex-col gap-2">
        <h2 id="export-files-label" className="text-xl font-semibold">
          ดาวน์โหลด
        </h2>

        <a
          href="/export/transactions"
          download={csvName}
          aria-label={`ดาวน์โหลดรายการทั้งหมดเป็น CSV (ไฟล์ ${csvName})`}
          aria-describedby="export-csv-desc"
          className="flex min-h-14 items-center justify-center rounded-card border border-border-strong bg-surface px-4 font-semibold"
        >
          ดาวน์โหลด CSV
        </a>
        <p id="export-csv-desc" className="text-[13px] leading-[18px] text-text-muted">
          ไฟล์ชื่อ <span className="num">{csvName}</span> · เปิดในสเปรดชีตได้ (UTF-8 มี BOM)
        </p>

        <a
          href="/export/backup"
          download={jsonName}
          aria-label={`ดาวน์โหลดข้อมูลสำรองเป็น JSON (ไฟล์ ${jsonName})`}
          aria-describedby="export-json-desc"
          className="flex min-h-14 items-center justify-center rounded-card border border-border-strong bg-surface px-4 font-semibold"
        >
          ดาวน์โหลด JSON (สำรอง)
        </a>
        <p id="export-json-desc" className="text-[13px] leading-[18px] text-text-muted">
          ไฟล์ชื่อ <span className="num">{jsonName}</span> · มีกระเป๋า หมวด งบ และรายการทั้งหมด
        </p>
      </section>

      <p className="text-[13px] leading-[18px] text-text-muted">
        ไฟล์มีข้อมูลการเงินของคุณเท่านั้น — เก็บไว้ในที่ที่คุณควบคุม ไม่มีใครอื่นเข้าถึงได้
      </p>
    </div>
  );
}
