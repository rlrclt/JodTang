'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { AmountKeypad, satangFromInput } from '@/components/AmountKeypad';
import { useOffline } from '@/components/Pwa';

import { SUGGESTED_CATEGORY_ID, categoryOf } from '@/lib/fixtures';

const KINDS = [
  { id: 'income', label: 'รับ' },
  { id: 'expense', label: 'จ่าย' },
  { id: 'transfer', label: 'โอน' },
] as const;

type Kind = (typeof KINDS)[number]['id'];

/**
 * S3 เพิ่มรายการเร็ว (design.md §4 S3 + §2)
 * - ใช้ <dialog> + showModal(): ได้ focus trap · Esc · ::backdrop ฟรี ไม่ต้องดึงไลบรารี
 * - ช่องจำนวนเงิน + แป้นตัวเลขใช้ <AmountKeypad> ร่วมกับ sheet ของงบ (ที่เดียว)
 * - ค่าเริ่มต้น = จ่าย (สัดส่วนใช้งานจริงสูงกว่า — §3)
 * - ยังไม่บันทึกจริง: เฟส 2 จะยิง optimistic + client_id (idempotency) แล้วปิด sheet
 */
export function AddEntryFab() {
  const offline = useOffline();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>('expense');
  const [amount, setAmount] = useState('');

  const open = () => {
    dialogRef.current?.showModal();
    // §2: เปิดแล้ว focus ไปที่ช่องจำนวนเงิน
    queueMicrotask(() => amountRef.current?.focus());
  };

  // เปิด sheet ตรง ๆ ด้วย ?add=1 (ใช้ถ่ายสกรีนช็อต/ทดสอบโดยไม่ต้องคลิก)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('add') === '1') open();
  }, []);

  // ปุ่มที่ไหนก็ได้ในแอปเปิด sheet นี้ได้ด้วย attribute `data-open-add`
  // (เช่น ปุ่ม "เพิ่มรายการ" ของ empty state ในหน้ารายการ) — ไม่ต้องส่ง handler ข้าม component
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-open-add]')) open();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // ใช้ตัวแปลงสตริง→สตางค์ตัวเดียว (ไม่ผ่าน Number(): กัน '8.29' → 828.9999999999999)
  const satang = satangFromInput(amount);
  const empty = satang === null || satang === 0;
  const suggested = categoryOf(SUGGESTED_CATEGORY_ID);
  const canSave = !empty && kind !== 'transfer'; // โอนต้องเลือกปลายทางก่อน — เฟส 2

  // หน้าเข้าสู่ระบบไม่มีปุ่มเพิ่มรายการ (ยังไม่มีผู้ใช้ให้บันทึก) — design.md §3
  if (pathname === '/login') return null;

  return (
    <>
      {/* FAB: ห่างขอบขวา 16 · เหนือแถบแท็บ 16 (design §2, z-index 30 §1.6) */}
      <button
        type="button"
        onClick={open}
        aria-label="เพิ่มรายการ"
        className="fixed bottom-[calc(56px+16px+env(safe-area-inset-bottom))] right-[max(16px,calc(50%-215px+16px))] z-30 flex size-14 items-center justify-center rounded-card bg-balance text-on-accent shadow-[var(--shadow-sticky)] active:scale-[0.98]"
      >
        <svg className="size-6" aria-hidden="true">
          <use href="#i-plus" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="เพิ่มรายการ"
        className="mt-auto mb-0 w-full max-w-[430px] rounded-t-[20px] border-0 bg-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom))] text-text shadow-[var(--shadow-sheet)] backdrop:bg-[rgb(2_6_23_/_0.45)] sm:mx-auto"
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-pill bg-border-strong" />

        <div className="flex flex-wrap gap-2" role="group" aria-label="ประเภทรายการ">
          {KINDS.map((item) => {
            const active = kind === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setKind(item.id)}
                className={`min-h-11 rounded-btn border px-4 font-semibold ${
                  active
                    ? `border-border-strong bg-surface-2 font-bold ${
                        item.id === 'income' ? 'text-income' : item.id === 'expense' ? 'text-expense' : 'text-[var(--balance)]'
                      }`
                    : 'border-border bg-surface text-text'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <AmountKeypad
          id="sheet-amount"
          label="จำนวนเงิน (บาท)"
          value={amount}
          onChange={setAmount}
          inputRef={amountRef}
          hint={<>วันนี้ · หมวด: {suggested?.name ?? 'เลือกภายหลัง'}</>}
        />

        {/* design.md §6: ออฟไลน์ v1 = อ่านอย่างเดียว — บอกให้ชัดว่าบันทึกไม่ได้ ไม่ใช่ปุ่มเงียบ ๆ */}
        {offline ? (
          <p className="mt-3 text-[13px] leading-[18px] text-warn">
            ออฟไลน์อยู่ — บันทึกใหม่ยังไม่ได้ (คิวออฟไลน์จะมาในเวอร์ชันถัดไป)
          </p>
        ) : null}

        {/* ปุ่มบันทึก: สูง 56 เสมอ (§2) อยู่ในระยะนิ้วโป้ง (ล่างขวาของ sheet) */}
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
            disabled={!canSave || offline}
            onClick={() => dialogRef.current?.close()}
            className="min-h-14 flex-1 rounded-btn bg-balance font-bold text-on-accent disabled:opacity-40"
          >
            บันทึก
          </button>
        </div>
      </dialog>
    </>
  );
}
