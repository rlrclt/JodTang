'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { formatSatang } from '@/lib/money';

import { ACCOUNT_KIND_LABELS, splitByArchived } from '@/components/settings-view';

import { AccountSheet, type AccountItem, type AccountPatch } from './AccountSheet';
import { restoreAccountAction } from './actions';

const rowButtonClass = 'flex min-h-14 w-full items-center gap-3 px-4 text-left';

/**
 * ลิสต์กระเป๋า (active ก่อน แล้วกลุ่ม "เลิกใช้แล้ว") — spec §1, §4, §5
 * - แถว active แตะได้ = เปิด sheet แก้ · แถวที่เลิกใช้แล้วอ่านอย่างเดียว + ปุ่ม "กู้คืน"
 * - กระเป๋าใบสุดท้าย: ปุ่มเลิกใช้ถูกปิดพร้อมเหตุผล (ชั้นข้อมูลก็กันไว้)
 */
export function AccountList({ items }: { items: AccountItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sheet, setSheet] = useState<{ item: AccountItem | null } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, AccountPatch>>({});
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setOverrides({}), [items]);

  // เปิด sheet ตรง ๆ ด้วย ?new=1 หรือ ?edit=<id> (ถ่ายสกรีนช็อต/ทดสอบโดยไม่ต้องคลิก)
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current) return;
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('edit');
    const found = wanted ? items.find((row) => row.id === wanted) : undefined;
    if (params.get('new') === '1') {
      deepLinkDone.current = true;
      setSheet({ item: null });
    } else if (found) {
      deepLinkDone.current = true;
      setSheet({ item: found });
    }
  }, [items]);

  const merge = (row: AccountItem): AccountItem => ({ ...row, ...overrides[row.id] });

  const optimistic = (id: string, patch: AccountPatch) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    return () =>
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
  };

  const done = () => {
    setSheet(null);
    startTransition(() => router.refresh());
  };

  const restore = async (row: AccountItem) => {
    setRestoring(row.id);
    setError(null);
    const rollback = optimistic(row.id, { archived: false });
    try {
      const result = await restoreAccountAction(row.id);
      if (result.ok) {
        startTransition(() => router.refresh());
        return;
      }
      rollback();
      setError(result.message);
    } catch {
      rollback();
      setError('กู้คืนไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
    } finally {
      setRestoring(null);
    }
  };

  const rows = items.map(merge);
  const { active, archived } = splitByArchived(rows);
  const canArchive = active.length > 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setSheet({ item: null })}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-card border border-border-strong bg-surface font-semibold"
      >
        <svg className="size-5" aria-hidden="true">
          <use href="#i-plus" />
        </svg>
        เพิ่มกระเป๋า
      </button>

      {error ? (
        <p role="alert" className="text-[13px] leading-[18px] text-warn">
          ⚠ {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-card border border-border bg-surface p-4">
          <p className="text-text-muted">ยังไม่มีกระเป๋า</p>
          <p className="text-[13px] leading-[18px] text-warn">⚠ บันทึกรายการไม่ได้ถ้าไม่มีกระเป๋า</p>
          <button
            type="button"
            onClick={() => setSheet({ item: null })}
            className="min-h-11 rounded-btn bg-balance px-4 font-bold text-on-accent"
          >
            เพิ่มกระเป๋า
          </button>
        </div>
      ) : (
        <>
          <ul className="overflow-hidden rounded-card border border-border bg-surface">
            {active.map((row) => (
              <li key={row.id} className="border-b border-border last:border-b-0">
                <button type="button" onClick={() => setSheet({ item: row })} className={rowButtonClass}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{row.name}</span>
                    <span className="num block truncate text-[13px] leading-[18px] text-text-muted">
                      {formatSatang(row.balance)} ·{' '}
                      {ACCOUNT_KIND_LABELS[row.kind as keyof typeof ACCOUNT_KIND_LABELS] ?? row.kind}
                    </span>
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-text-muted">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {archived.length > 0 ? (
            <>
              <h2 className="mt-2 text-[13px] leading-[18px] text-text-muted">เลิกใช้แล้ว ({archived.length})</h2>
              <ul className="overflow-hidden rounded-card border border-border bg-surface">
                {archived.map((row) => (
                  <li key={row.id} className="flex min-h-14 items-center gap-3 border-b border-border px-4 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="block truncate font-semibold text-text-muted">{row.name}</span>
                        <span className="shrink-0 rounded-pill border border-border-strong px-2 py-0.5 text-[13px] leading-[18px] text-text-muted">
                          เลิกใช้แล้ว
                        </span>
                      </span>
                      <span className="num block truncate text-[13px] leading-[18px] text-text-muted opacity-70">
                        {formatSatang(row.balance)} ·{' '}
                        {ACCOUNT_KIND_LABELS[row.kind as keyof typeof ACCOUNT_KIND_LABELS] ?? row.kind}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => restore(row)}
                      disabled={restoring !== null}
                      className="min-h-11 shrink-0 rounded-btn border border-border-strong px-3 font-semibold disabled:opacity-40"
                    >
                      {restoring === row.id ? 'กำลังกู้คืน…' : 'กู้คืน'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}

      {sheet ? (
        <AccountSheet
          item={sheet.item}
          canArchive={canArchive}
          onOptimistic={(patch) => optimistic(sheet.item?.id ?? 'new', patch)}
          onDone={done}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}
