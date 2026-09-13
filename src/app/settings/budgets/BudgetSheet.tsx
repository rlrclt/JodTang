'use client';

import { useEffect, useRef, useState } from 'react';

import { AmountKeypad, inputFromSatang, satangFromInput } from '@/components/AmountKeypad';
import { formatSatang } from '@/lib/money';

import { clearBudgetAction, saveBudgetAction } from './actions';

/** หมวดรายจ่าย 1 แถวในหน้านี้ + งบของเดือนปัจจุบันถ้ามี (สตางค์) */
export type BudgetItem = {
  categoryId: string;
  name: string;
  color: string | null;
  /** หมวดเลิกใช้แล้ว: แก้ไม่ได้ แต่ล้างงบเดิมได้ (ต้องโชว์ให้เห็น ไม่ซ่อน) */
  archived: boolean;
  budgetId: string | null;
  amount: number | null;
};

type Props = {
  item: BudgetItem;
  periodLabel: string;
  /**
   * ยิง optimistic ก่อนรอเซิร์ฟเวอร์ — คืนฟังก์ชันสำหรับ rollback ค่าเดิม
   * (ผู้เรียกเป็นเจ้าของแถวในลิสต์ จึงเป็นคนปรับตัวเลข)
   */
  onOptimistic: (categoryId: string, amount: number | null) => () => void;
  /** บันทึกสำเร็จ — ปิด sheet */
  onDone: () => void;
  /** ปิด sheet (ยกเลิก/Esc/แตะฉากหลัง) */
  onClose: () => void;
};

/**
 * ตั้ง/แก้/ล้างงบของหมวดหนึ่ง (ข้อเสนอ §2) — bottom sheet ตามแพตเทิร์น <dialog>+showModal() ของ AddEntrySheet
 * - ใช้ <AmountKeypad> ร่วม (implementation เดียวกับ sheet เพิ่มรายการ)
 * - บันทึกพลาด: rollback แถว + **ไม่ปิด sheet** + เก็บค่าที่กรอกไว้ + บอกข้อความไทย (ห้ามรหัส DB)
 */
export function BudgetSheet({ item, periodLabel, onOptimistic, onDone, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(item.amount === null ? '' : inputFromSatang(item.amount));
  const [busy, setBusy] = useState<null | 'save' | 'clear'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    // §2: เปิดแล้ว focus ไปที่ช่องจำนวนเงิน
    queueMicrotask(() => inputRef.current?.focus());
  }, []);

  const satang = satangFromInput(amount);
  const canSave = !item.archived && satang !== null && satang > 0 && busy === null;

  const save = async () => {
    if (!canSave) return;
    const next = satang;
    setBusy('save');
    setError(null);
    const rollback = onOptimistic(item.categoryId, next); // แถวขยับทันที
    const result = await saveBudgetAction(item.categoryId, next);
    if (result.ok) {
      onDone();
      return;
    }
    rollback();
    setBusy(null);
    setError(result.message); // ค่าที่พิมพ์ยังอยู่ในช่อง (ไม่ล้าง)
  };

  const clear = async () => {
    if (!item.budgetId || busy !== null) return;
    setBusy('clear');
    setError(null);
    const rollback = onOptimistic(item.categoryId, null);
    const result = await clearBudgetAction(item.budgetId);
    if (result.ok) {
      onDone();
      return;
    }
    rollback();
    setBusy(null);
    setError(result.message);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={`งบของ ${item.name}`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close(); // แตะฉากหลัง = ปิด (§2)
      }}
      className="mt-auto mb-0 w-full max-w-[430px] rounded-t-[20px] border-0 bg-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom))] text-text shadow-[var(--shadow-sheet)] backdrop:bg-[rgb(2_6_23_/_0.45)] sm:mx-auto"
    >
      <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-pill bg-border-strong" />

      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-pill"
          style={{ background: item.color ? `var(${item.color})` : 'var(--balance)' }}
        />
        <h2 className="min-w-0 flex-1 truncate text-xl font-semibold">{item.name}</h2>
        {item.archived ? (
          <span className="shrink-0 rounded-pill border border-border-strong px-2 py-0.5 text-[13px] leading-[18px] text-text-muted">
            เลิกใช้แล้ว
          </span>
        ) : null}
      </div>

      {item.archived ? (
        <p className="mt-2 text-[13px] leading-[18px] text-warn">
          หมวดนี้เลิกใช้แล้ว — ตั้งงบใหม่ไม่ได้ แต่ล้างงบเดิมได้
        </p>
      ) : null}

      <AmountKeypad
        id="budget-amount"
        label={`งบของเดือนนี้ (บาท) — ${periodLabel}`}
        value={amount}
        onChange={setAmount}
        inputRef={inputRef}
        disabled={item.archived || busy !== null}
        hint="งบเป็นของเดือนนี้เดือนเดียว ไม่พกไปเดือนถัดไป"
      />

      {amount !== '' && satang !== null && satang > 0 ? (
        <p className="mt-2 text-[13px] leading-[18px] text-text-muted">จะตั้งงบ {formatSatang(satang)}</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-[13px] leading-[18px] text-warn">
          ⚠ {error}
        </p>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={clear}
          disabled={!item.budgetId || busy !== null}
          className="min-h-14 rounded-btn border border-border px-4 font-semibold disabled:opacity-40"
        >
          {busy === 'clear' ? 'กำลังล้าง…' : 'ล้างงบ'}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="min-h-14 flex-1 rounded-btn bg-balance font-bold text-on-accent disabled:opacity-40"
        >
          {busy === 'save' ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>
    </dialog>
  );
}
