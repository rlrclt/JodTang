'use client';

import { useEffect, useRef, useState } from 'react';

import { TextField } from '@/components/FormControls';
import { announce } from '@/components/announce-store';

import { saveEmailAction } from './actions';
import { emailDisplay } from './email-view';

/**
 * แถวอีเมลในหน้าตั้งค่า + ชีตตั้ง/แก้ (wave25)
 *
 * - อีเมลตัวแทน (`<sub>@line.local`) และอีเมลว่าง → แสดง **"ยังไม่ได้ตั้งอีเมล"** (ห้ามโชว์ที่อยู่ภายในระบบ)
 * - `emailVerified = true` (มาจากผู้ให้บริการ เช่น Google) → ป้าย "ยืนยันแล้ว" + **อ่านอย่างเดียว ไม่มีปุ่มแก้**
 *   (เหตุผล: ตั้งใหม่ได้ `false` เสมอ = ผู้ใช้จะเสียสถานะยืนยันโดยไม่ได้อะไรกลับมา → ไปแก้ที่ผู้ให้บริการ)
 * - `emailVerified = false` → ป้าย "ยังไม่ยืนยัน" (`text-warn`) + ปุ่มแก้ไข · เราไม่มีการยืนยันอีเมลในเวอร์ชันนี้
 * - ⚠ ไม่ใช่กุญแจเชื่อมบัญชีข้าม provider (PLAN §3) — ตั้งอีเมลแล้วไม่ได้สิทธิ์เข้าระบบเพิ่ม
 */
export function EmailControl({
  email,
  emailVerified,
  usesPlaceholderEmail,
}: {
  /** อีเมลที่เก็บจริงใน DB (null = ยังไม่ได้ตั้ง) */
  email: string | null;
  /** true = ยืนยันจากผู้ให้บริการแล้ว → อ่านอย่างเดียว */
  emailVerified: boolean;
  /** true = อีเมลตัวแทนที่ระบบสร้างให้ → ห้ามแสดงเป็นอีเมลจริง */
  usesPlaceholderEmail: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * ค่าที่เพิ่งบันทึก — เป็น **ค่าที่ชั้นข้อมูลคืนมาจริง** (UPDATE … RETURNING) ไม่ใช่ค่าที่ผู้ใช้พิมพ์
   * บน branch dev ที่ sleep อยู่ action ใช้เวลา ~5 วินาที (คิวรีแรกเจอ cold start) — แถวจึงโชว์ค่านี้ทันทีที่รู้ผล
   * เมื่อ props ชุดใหม่จาก server มา (re-render) effect ล้างค่านี้ทิ้ง — server ชนะเสมอ
   */
  const [saved, setSaved] = useState<{ email: string | null; emailVerified: boolean } | null>(null);

  // ค่าจริงจาก server มาแล้ว → ทิ้งค่า optimistic (ชั้นข้อมูลnormalize/ปฏิเสธได้ — ต้องเชื่อ server)
  useEffect(() => {
    setSaved(null);
  }, [email, emailVerified]);

  // กติกาการแสดงผลทั้งหมดอยู่ในฟังก์ชันบริสุทธิ์ (มีเทสต์) — component แค่ render ตามนั้น
  // ใช้ค่าที่เพิ่งบันทึกก่อน (ถ้ามี) — optimistic เฉพาะตอนเพิ่งกดสำเร็จ ไม่ได้เดาจากที่อื่น
  const display = emailDisplay({
    email: saved ? saved.email : email,
    emailVerified: saved ? saved.emailVerified : emailVerified,
    usesPlaceholderEmail: saved ? false : usesPlaceholderEmail,
  });

  const openSheet = () => {
    setValue(display.fieldValue); // ช่องว่าง = ยังไม่มี/ล้าง
    setError(null);
    dialogRef.current?.showModal();
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = value.trim();
      const result = await saveEmailAction({ email: trimmed === '' ? null : trimmed });
      if (!result.ok) {
        setError(result.message); // ชีตไม่ปิด ค่าที่พิมพ์ยังอยู่ (ข้อความไทยจากชั้นข้อมูล)
        return;
      }
      // ใช้ **ค่าที่ชั้นข้อมูลคืนมาจริง** (UPDATE … RETURNING — normalize/ตรวจมาแล้ว) ไม่เดาจากสิ่งที่ผู้ใช้พิมพ์
      setSaved({ email: result.email, emailVerified: result.emailVerified });
      announce('บันทึกอีเมลแล้ว · ยังไม่ยืนยัน');
      dialogRef.current?.close();
      // ไม่เรียก router.refresh() (wave26): ค่าที่โชว์คือค่าที่ action คืนมาเอง ⇒ ไม่มีอะไรต้อง sync ซ้ำ
      // และบน branch ที่ sleep การ refresh = คิวรีจาก DB อีก ~5 วิโดยไม่ได้อะไรกลับมา
      // วัดแล้วว่าไม่มี Router Cache ค้าง: แก้อีเมลจากนอกแอป (SQL) แล้วเข้า /settings ด้วย client navigation
      // (ไม่ hard reload) → แถวสะท้อนค่าใหม่ทันที · หน้าอื่นที่ยังคง refresh ไว้เป็นแพตเทิร์นเดิมของชีตนั้น ๆ
    } catch {
      setError('บันทึกอีเมลไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
    } finally {
      setBusy(false);
    }
  };

  return (
    // div (ไม่ใช่ span) เพราะมี <dialog> อยู่ข้างใน — dialog เป็น flow content ใส่ใน span ไม่ได้
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="min-w-0 truncate text-[13px] leading-[18px] text-text-muted">
        {busy ? 'กำลังบันทึก…' : display.label}
      </span>

      {!busy && display.badge === 'verified' ? (
        <span className="shrink-0 rounded-pill border border-border-strong px-2 py-0.5 text-[13px] leading-[18px] text-[var(--balance)]">
          ยืนยันแล้ว
        </span>
      ) : null}
      {!busy && display.badge === 'unverified' ? (
        <span className="shrink-0 rounded-pill border border-border px-2 py-0.5 text-[13px] leading-[18px] text-warn">
          ยังไม่ยืนยัน
        </span>
      ) : null}

      {!busy && display.canEdit && display.buttonLabel ? (
        <button
          type="button"
          onClick={openSheet}
          className="min-h-11 shrink-0 rounded-btn border border-border-strong px-3 font-semibold"
        >
          {display.buttonLabel}
        </button>
      ) : null}

      {/* <dialog> ต้องอยู่ใน DOM ตลอด (เหมือน AddEntryFab) — ถ้า render แบบมีเงื่อนไข ref จะเป็น null ตอนสั่ง showModal() */}
      <dialog
        ref={dialogRef}
        aria-labelledby="email-sheet-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="mt-auto mb-0 w-full max-w-[430px] rounded-t-[20px] border-0 bg-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom))] text-text shadow-[var(--shadow-sheet)] backdrop:bg-[rgb(2_6_23_/_0.45)] sm:mx-auto"
      >
        {open ? (
          <>
          <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-pill bg-border-strong" />
          <h2 id="email-sheet-title" className="text-xl font-semibold">
            อีเมลของบัญชี
          </h2>

          {/* สถานะอยู่เหนือช่องกรอกเสมอ (spec §4) */}
          <p className="mt-1 text-[13px] leading-[18px] text-text-muted">
            {display.badge === 'unverified'
              ? 'สถานะ: ยังไม่ยืนยัน — แอปนี้ยังไม่มีการยืนยันอีเมลในเวอร์ชันนี้'
              : 'ยังไม่ได้ตั้งอีเมล — ตั้งไว้เพื่อให้ติดต่อ/กู้บัญชีได้ในอนาคต'}
          </p>

          <TextField
            id="own-email"
            label="อีเมล"
            value={value}
            onChange={setValue}
            disabled={busy}
            placeholder="name@example.com"
            errorId={error ? 'email-error' : undefined}
            inputMode="email"
            autoComplete="email"
          />
          <p className="mt-1 text-[13px] leading-[18px] text-text-muted">
            เว้นว่างแล้วกดบันทึก = ล้างอีเมล (กลับเป็น &ldquo;ยังไม่ได้ตั้งอีเมล&rdquo;)
          </p>

          {error ? (
            <p id="email-error" role="alert" className="mt-2 text-[13px] leading-[18px] text-warn">
              ⚠ {error}
            </p>
          ) : null}

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="min-h-14 rounded-btn border border-border px-4 font-semibold"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="min-h-14 flex-1 rounded-btn bg-balance font-bold text-on-accent disabled:opacity-40"
            >
              {busy ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
          </>
        ) : null}
      </dialog>
    </div>
  );
}
