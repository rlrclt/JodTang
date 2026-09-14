'use client';

import { useEffect, useRef, useState } from 'react';

import { AmountInput, AmountKeys, inputFromSatang, satangFromInput } from '@/components/AmountKeypad';
import { OptionChips, TextField } from '@/components/FormControls';
import { ACCOUNT_KIND_OPTIONS } from '@/components/settings-view';

import { announce } from '@/components/announce-store';
import { settingsErrorField } from '@/components/settings-view';
import { archiveAccountAction, saveAccountAction, type ManageResult } from './actions';

/** กระเป๋า 1 แถวในหน้านี้ (usage = จำนวนรายการที่อ้างถึง — รวมที่เป็นกระเป๋าปลายทางของโอน) */
export type AccountItem = {
  id: string;
  name: string;
  kind: string;
  archived: boolean;
  usage: number;
  /** ยอดคงเหลือ "ตอนนี้" (สตางค์) — มาจาก accountBalances · ใช้แสดงผลเท่านั้น ห้ามใช้เป็นค่าในฟอร์ม */
  balance: number;
  /** ยอดตั้งต้นที่บันทึกไว้ (สตางค์) — มาจาก accounts.initial_balance · **ค่าเดียวที่ฟอร์มใช้ prefill** */
  initialBalance: number;
};

export type AccountPatch = Partial<Pick<AccountItem, 'name' | 'kind' | 'balance' | 'archived'>>;

type Props = {
  /** null = เพิ่มใหม่ */
  item: AccountItem | null;
  /** archive ได้ไหม (false = เหลือใบสุดท้าย) + เหตุผลที่บอกผู้ใช้ */
  canArchive: boolean;
  onOptimistic: (patch: AccountPatch) => () => void;
  onDone: () => void;
  onClose: () => void;
};

/** ผลกระทบที่ต้องบอกก่อนเลิกใช้กระเป๋า (wave9 §4 + wave10b §5 ปิด loop ของ accountUsage) */
const ARCHIVE_IMPACT =
  'รายการเก่ายังอยู่และยังนับในยอด · กระเป๋าจะไม่ให้เลือกตอนบันทึกรายการใหม่ · ยังไม่มี "ย้ายรายการไปกระเป๋าอื่น" ในเวอร์ชันนี้';

/**
 * เพิ่ม/แก้/เลิกใช้กระเป๋า (spec §2) — kind แก้ได้ (ต่างจากหมวด) เพราะ DB ไม่ได้ผูก kind ของกระเป๋ากับรายการ
 * ยอดตั้งต้น: มีแล้ว (wave10b §5) — prefill จาก `item.initialBalance` (ยอดที่บันทึกไว้) เสมอ
 * ห้าม prefill จาก `item.balance` (ยอดปัจจุบัน) เด็ดขาด: เคยเป็นบั๊ก Critical — แค่เปลี่ยนชื่อก็เขียนทับ initial_balance
 */
export function AccountSheet({ item, canArchive, onOptimistic, onDone, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState(item?.kind ?? 'cash');
  // ยอดตั้งต้น: แยก "เครื่องหมาย" ออกจาก "จำนวน" เพราะแป้นตัวเลขของแอปไม่มีปุ่มลบ (บัตรเครดิตมียอดติดลบได้)
  const [balanceSign, setBalanceSign] = useState<'plus' | 'minus'>((item?.initialBalance ?? 0) < 0 ? 'minus' : 'plus');
  const [initialBalance, setInitialBalance] = useState(
    item ? inputFromSatang(Math.abs(item.initialBalance)) : '0.00',
  );
  const [busy, setBusy] = useState<null | 'save' | 'archive'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const trimmed = name.trim();
  const canSave = trimmed !== '' && busy === null;

  const runWrite = async (mode: 'save' | 'archive', optimistic: AccountPatch, call: () => Promise<ManageResult>) => {
    setBusy(mode);
    setError(null);
    const rollback = onOptimistic(optimistic);
    try {
      const result = await call();
      if (result.ok) {
        announce(mode === 'save' ? 'บันทึกกระเป๋าแล้ว' : 'เลิกใช้กระเป๋าแล้ว'); // ทุกการเขียนต้องได้ยินผล (wave18b)
        onDone();
        return;
      }
      rollback();
      setError(result.message);
    } catch (failure) {
      console.error('[jodjai] account write failed:', failure);
      rollback();
      setError(mode === 'save' ? 'บันทึกไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)' : 'เลิกใช้กระเป๋าไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!canSave) return;
    const magnitude = satangFromInput(initialBalance) ?? 0;
    const initialBalanceSatang = balanceSign === 'minus' ? -magnitude : magnitude;
    // ส่งฟิลด์นี้เฉพาะเมื่อ "ค่าที่ตั้งใจ" ต่างจากที่บันทึกไว้จริง
    // (ชั้นข้อมูล merge จากแถวเดิมอยู่แล้ว ⇒ ไม่ส่ง = ไม่แตะคอลัมน์นั้น) — กันบั๊กประเภท "ฟอร์ม prefill ผิดแล้วทับค่า"
    const touched = item === null || initialBalanceSatang !== item.initialBalance;
    runWrite('save', { name: trimmed, kind }, () =>
      saveAccountAction({
        id: item?.id,
        name: trimmed,
        kind,
        ...(touched ? { initialBalance: initialBalanceSatang } : {}),
      }),
    );
  };

  const archive = () => {
    if (!item || busy !== null || !canArchive) return;
    runWrite('archive', { archived: true }, () => archiveAccountAction(item.id));
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="account-sheet-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="mt-auto mb-0 w-full max-w-[430px] rounded-t-[20px] border-0 bg-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom))] text-text shadow-[var(--shadow-sheet)] backdrop:bg-[rgb(2_6_23_/_0.45)] sm:mx-auto"
    >
      <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-pill bg-border-strong" />
      <h2 id="account-sheet-title" className="text-xl font-semibold">
        {item ? 'แก้กระเป๋า' : 'เพิ่มกระเป๋า'}
      </h2>

      <TextField
        id="account-name"
        errorId={error && settingsErrorField(error) === 'name' ? 'account-error' : undefined}
        label="ชื่อกระเป๋า"
        value={name}
        onChange={setName}
        disabled={busy !== null}
        placeholder="เช่น เงินสด"
        autoFocus
      />

      <OptionChips
        legend="ชนิด"
        value={kind}
        onChange={setKind}
        disabled={busy !== null}
        options={ACCOUNT_KIND_OPTIONS.map((option) => ({ id: option.id as string, label: option.label }))}
      />

      <div className="flex items-end justify-between gap-2">
        <p className="text-[13px] leading-[18px] text-text-muted">ยอดตั้งต้น (ตอนเริ่มใช้)</p>
        <button
          type="button"
          disabled={busy !== null}
          aria-pressed={balanceSign === 'minus'}
          onClick={() => setBalanceSign((prev) => (prev === 'minus' ? 'plus' : 'minus'))}
          className="min-h-11 rounded-btn border border-border px-3 text-[13px] font-semibold disabled:opacity-40"
        >
          {balanceSign === 'minus' ? 'ติดลบ (−)' : 'บวก (+)'}
        </button>
      </div>
      <AmountInput
        id="account-balance"
        errorId={error && settingsErrorField(error) === 'balance' ? 'account-error' : undefined}
        label=""
        value={initialBalance}
        onChange={setInitialBalance}
        disabled={busy !== null}
      />
      <p className="mt-1 text-[13px] leading-[18px] text-text-muted">
        ยอดปัจจุบัน = ยอดตั้งต้น ± รายการ · บัตรเครดิตใช้ยอดติดลบได้
      </p>
      <AmountKeys value={initialBalance} onChange={setInitialBalance} disabled={busy !== null} />

      {error ? (
        <p id="account-error" role="alert" className="mt-2 text-[13px] leading-[18px] text-warn">
          ⚠ {error}
        </p>
      ) : null}

      {confirmingArchive ? (
        <div className="mt-3 rounded-card border border-border-strong bg-surface-2 p-3">
          <p className="font-semibold">เลิกใช้กระเป๋านี้?</p>
          {(item?.usage ?? 0) > 0 ? (
            <p className="mt-1 text-[13px] leading-[18px] text-text">
              กระเป๋านี้มี {item?.usage} รายการ · เลิกใช้แล้วรายการยังอยู่และยังนับในยอด
            </p>
          ) : null}
          <p className="mt-1 text-[13px] leading-[18px] text-text-muted">{ARCHIVE_IMPACT}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmingArchive(false)}
              className="min-h-11 rounded-btn border border-border px-4 font-semibold"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={archive}
              disabled={busy !== null}
              className="min-h-11 rounded-btn bg-warn px-4 font-bold text-on-accent disabled:opacity-40"
            >
              {busy === 'archive' ? 'กำลังเลิกใช้…' : 'ยืนยันเลิกใช้'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {item ? (
            canArchive ? (
              <button
                type="button"
                onClick={() => setConfirmingArchive(true)}
                disabled={busy !== null}
                className="mt-3 flex min-h-11 items-center font-semibold text-warn disabled:opacity-40"
              >
                เลิกใช้กระเป๋านี้
              </button>
            ) : (
              // ใบสุดท้าย: บอกเหตุผลตั้งแต่ยังไม่กด (ชั้นข้อมูลก็กันไว้อีกชั้น)
              <p className="mt-3 text-[13px] leading-[18px] text-warn">
                ⚠ ต้องมีกระเป๋าอย่างน้อย 1 ใบ — เลิกใช้ใบนี้ไม่ได้
              </p>
            )
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
              disabled={!canSave}
              className="min-h-14 flex-1 rounded-btn bg-balance font-bold text-on-accent disabled:opacity-40"
            >
              {busy === 'save' ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
