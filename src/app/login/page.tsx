import { redirect } from 'next/navigation';

import { LoginButtons } from '@/components/AuthButtons';
import { getSession } from '@/lib/session';

export const metadata = { title: 'เข้าสู่ระบบ · จดจ่าย' };

/** ข้อความ error ที่ผู้ใช้อ่านรู้เรื่อง — ห้ามโชว์รหัส/ข้อความดิบของ provider (design.md §4) */
function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code === 'access_denied' || code === 'cancelled') return 'ยกเลิกการล็อกอินไปแล้ว ลองใหม่ได้เลย';
  return 'ล็อกอินไม่สำเร็จ ลองใหม่';
}

/**
 * S1 เข้าสู่ระบบ (design.md §4 S1)
 * ปุ่มเดียวต่อผู้ให้บริการ · ไม่มี modal · ล็อกอินแล้วเข้ามาที่นี่อีก → กลับหน้าแรก
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSession()) redirect('/');

  // provider จะใช้ได้ต่อเมื่อมีคีย์ครบทั้งคู่ — คีย์ว่าง (ค่าเริ่มต้นของโปรเจกต์) ต้องไม่ทำให้หน้าพัง
  const enabled = {
    google: Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()),
    line: Boolean(process.env.LINE_CLIENT_ID?.trim() && process.env.LINE_CLIENT_SECRET?.trim()),
  };
  const error = errorMessage((await searchParams).error);

  return (
    <div className="flex flex-col gap-6 pt-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">เข้าสู่ระบบ</h1>
        <p className="text-text-muted">บันทึกรายรับรายจ่ายให้เสร็จในไม่กี่วินาที</p>
      </header>

      {error ? (
        <p role="alert" className="rounded-card border border-border bg-surface p-4 text-warn">
          {error}
        </p>
      ) : null}

      {/* ไม่มี provider ไหนพร้อม: บอกให้ชัดว่าติดอะไร ไม่ใช่ปุ่มกดไม่ได้ลอย ๆ */}
      {!enabled.google && !enabled.line ? (
        <p className="rounded-card border border-border bg-surface p-4 text-[13px] leading-[18px] text-text-muted">
          ยังล็อกอินไม่ได้ — โปรเจกต์นี้ยังไม่ได้ตั้งคีย์ของผู้ให้บริการ (GOOGLE_CLIENT_ID · LINE_CLIENT_ID)
          วิธีขอคีย์อยู่ใน docs/SETUP.md แล้วกลับมาใส่ใน .env.local
        </p>
      ) : null}

      <LoginButtons enabled={enabled} />

      <p className="text-[13px] leading-[18px] text-text-muted">
        เราเก็บเฉพาะข้อมูลที่จำเป็นต่อบัญชีของคุณ (ชื่อและอีเมลจากผู้ให้บริการ) เพื่อผูกข้อมูลการเงินไว้กับคุณคนเดียว
      </p>
    </div>
  );
}
