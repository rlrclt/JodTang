'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { TransactionRow, type TransactionRowView } from '@/components/TransactionRow';
import { announce } from '@/components/announce-store';

import { restoreTransactionAction } from './actions';

/**
 * แถวในถังขยะ (wave21) — แถวสไตล์เดิม + ปุ่ม "กู้คืน" 1 ปุ่มท้ายแถว
 *
 * - **ไม่มียืนยัน**: กู้คืนไม่ทำลายข้อมูล (ต่างจากการลบ) → 1 แตะจบ
 * - ระหว่าง pending: ปุ่ม disabled + "กำลังกู้คืน…" (กันดับเบิลแทป/สองแท็บ)
 * - พลาด: ข้อความไทยจาก action อยู่ **บนแถวนั้น** (เต็มความกว้างใต้แถว) และแถวไม่หายจนสำเร็จจริง
 * - สำเร็จ: ประกาศผ่าน live region ถาวร (aria-live) แล้ว router.refresh() — ไม่ reload ทั้งหน้า
 */
export function TrashRow({ view }: { view: TransactionRowView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await restoreTransactionAction(view.id);
      if (!result.ok) {
        setError(result.message); // กู้ซ้ำ/กระเป๋าถูกเลิกใช้ → ข้อความไทย ไม่ใช่ 500
        return;
      }
      announce('กู้คืนรายการแล้ว');
      router.refresh();
    } catch {
      setError('กู้คืนไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
    } finally {
      setBusy(false);
    }
  };

  return (
    <TransactionRow
      view={view}
      action={
        <button
          type="button"
          onClick={restore}
          disabled={busy}
          className="min-h-11 rounded-btn border border-border-strong px-3 font-semibold disabled:opacity-40"
        >
          {busy ? 'กำลังกู้คืน…' : 'กู้คืน'}
        </button>
      }
      below={
        error ? (
          <p role="alert" className="px-2 pb-2 text-[13px] leading-[18px] text-warn">
            ⚠ {error}
          </p>
        ) : null
      }
    />
  );
}
