'use client';

import { useEffect, useRef, useState } from 'react';

import { OptionChips, TextField, optionChipClass } from '@/components/FormControls';
import { CATEGORY_KIND_LABELS, colorLabel, colorOptionsFor } from '@/components/settings-view';

import { announce } from '@/components/announce-store';
import { settingsErrorField } from '@/components/settings-view';
import { archiveCategoryAction, saveCategoryAction, type ManageResult } from './actions';

/** หมวด 1 แถวในหน้านี้ (usage = จำนวนรายการที่อ้างถึง ใช้ตัดสินใจตอนเลิกใช้) */
export type CategoryItem = {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  color: string | null;
  archived: boolean;
  usage: number;
};

export type CategoryPatch = Partial<Pick<CategoryItem, 'name' | 'color' | 'archived'>>;

type Props = {
  /** null = เพิ่มใหม่ (kind เลือกได้) · มีค่า = แก้ (kind อ่านอย่างเดียว) */
  item: CategoryItem | null;
  /** ยิง optimistic ก่อนรอเซิร์ฟเวอร์ — คืนฟังก์ชัน rollback (ผู้เรียกเป็นเจ้าของแถว) */
  onOptimistic: (patch: CategoryPatch) => () => void;
  onDone: () => void;
  onClose: () => void;
};

/** ผลกระทบที่ต้องบอกก่อนเลิกใช้ (spec §4) — ต้องเป็นความจริง ไม่ใช่คำขู่ */
const ARCHIVE_IMPACT =
  'รายการเก่ายังอยู่และยังนับในยอด · หมวดจะไม่ให้เลือกตอนบันทึกรายการใหม่ · งบของหมวดนี้ (ถ้ามี) ยังคิดยอดจากรายการเดิม';

/**
 * เพิ่ม/แก้/เลิกใช้หมวด (spec §2, §4) — bottom sheet ตามแพตเทิร์น BudgetSheet
 * - เพิ่มกับแก้ใช้ sheet เดียวกัน: ต่างกันที่ kind เลือกได้/อ่านอย่างเดียว
 * - พลาด: rollback แถว + **ไม่ปิด sheet** + ค่าที่กรอกยังอยู่ + ข้อความไทย
 */
export function CategorySheet({ item, onOptimistic, onDone, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(item?.name ?? '');
  const [kind, setKind] = useState<'income' | 'expense'>(item?.kind ?? 'expense');
  const [color, setColor] = useState<string | null>(item?.color ?? null);
  const [busy, setBusy] = useState<null | 'save' | 'archive'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const trimmed = name.trim();
  const canSave = trimmed !== '' && busy === null;

  /** ทุกการเขียน: optimistic → action → สำเร็จปิด sheet · ล้ม (ok:false หรือ promise reject) = rollback + ข้อความ */
  const runWrite = async (mode: 'save' | 'archive', optimistic: CategoryPatch, call: () => Promise<ManageResult>) => {
    setBusy(mode);
    setError(null);
    const rollback = onOptimistic(optimistic);
    try {
      const result = await call();
      if (result.ok) {
        announce(mode === 'save' ? 'บันทึกหมวดแล้ว' : 'เลิกใช้หมวดแล้ว'); // ทุกการเขียนต้องได้ยินผล (wave18b)
        onDone();
        return;
      }
      rollback();
      setError(result.message);
    } catch (failure) {
      console.error('[jodjai] category write failed:', failure);
      rollback();
      setError(mode === 'save' ? 'บันทึกไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)' : 'เลิกใช้หมวดไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!canSave) return;
    runWrite('save', { name: trimmed, color }, () =>
      saveCategoryAction({ id: item?.id, kind, name: trimmed, color }),
    );
  };

  const archive = () => {
    if (!item || busy !== null) return;
    runWrite('archive', { archived: true }, () => archiveCategoryAction(item.id));
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="category-sheet-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="mt-auto mb-0 w-full max-w-[430px] rounded-t-[20px] border-0 bg-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom))] text-text shadow-[var(--shadow-sheet)] backdrop:bg-[rgb(2_6_23_/_0.45)] sm:mx-auto"
    >
      <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-pill bg-border-strong" />
      <h2 id="category-sheet-title" className="text-xl font-semibold">
        {item ? 'แก้หมวด' : 'เพิ่มหมวด'}
      </h2>

      <TextField
        id="category-name"
        errorId={error && settingsErrorField(error) === 'name' ? 'category-error' : undefined}
        label="ชื่อหมวด"
        value={name}
        onChange={setName}
        disabled={busy !== null}
        placeholder="เช่น อาหาร"
        autoFocus
      />

      {item ? (
        // kind แก้ไม่ได้: transactions ผูก (category_id, kind, user_id) ผ่าน composite FK — เปลี่ยนแล้วรายการเก่าพัง
        <p className="mt-3 text-[13px] leading-[18px] text-text-muted">
          ประเภท: <span className="font-semibold text-text">{CATEGORY_KIND_LABELS[item.kind]}</span> · เปลี่ยนไม่ได้
          เพราะรายการเก่าอ้างถึงอยู่
        </p>
      ) : (
        <OptionChips
          legend="ประเภท"
          value={kind}
          onChange={setKind}
          disabled={busy !== null}
          options={[
            { id: 'expense', label: CATEGORY_KIND_LABELS.expense },
            { id: 'income', label: CATEGORY_KIND_LABELS.income },
          ]}
        />
      )}

      <fieldset className="mt-3">
        <legend className="text-[13px] leading-[18px] text-text-muted">สี</legend>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {colorOptionsFor(kind).map((token) => (
            <button
              key={token}
              type="button"
              disabled={busy !== null}
              aria-pressed={color === token}
              aria-label={`สี${colorLabel(token)}`}
              onClick={() => setColor(token)}
              className={`flex size-11 items-center justify-center rounded-pill border-2 disabled:opacity-40 ${
                color === token ? 'border-text' : 'border-transparent'
              }`}
            >
              <span aria-hidden="true" className="size-7 rounded-pill" style={{ background: `var(${token})` }} />
            </button>
          ))}
          <button
            type="button"
            disabled={busy !== null}
            aria-pressed={color === null}
            onClick={() => setColor(null)}
            className={`${optionChipClass(color === null)} disabled:opacity-40`}
          >
            ไม่ระบุสี
          </button>
        </div>
      </fieldset>

      {error ? (
        <p id="category-error" role="alert" className="mt-2 text-[13px] leading-[18px] text-warn">
          ⚠ {error}
        </p>
      ) : null}

      {confirmingArchive ? (
        <div className="mt-3 rounded-card border border-border-strong bg-surface-2 p-3">
          <p className="font-semibold">เลิกใช้หมวดนี้?</p>
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
            <button
              type="button"
              onClick={() => setConfirmingArchive(true)}
              disabled={busy !== null}
              className="mt-3 flex min-h-11 items-center font-semibold text-warn disabled:opacity-40"
            >
              เลิกใช้หมวดนี้
            </button>
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
