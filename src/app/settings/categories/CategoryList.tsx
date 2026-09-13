'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { CATEGORY_KIND_LABELS, splitByArchived } from '@/components/settings-view';

import { restoreCategoryAction } from './actions';
import { CategorySheet, type CategoryItem, type CategoryPatch } from './CategorySheet';

/** แถว label เดียวกับที่หน้าอื่นใช้ (ปุ่ม/แถวสูง ≥44px, ทั้งแถวแตะได้เมื่อยังใช้งาน) */
const rowButtonClass = 'flex min-h-14 w-full items-center gap-3 px-4 text-left';

/**
 * ลิสต์หมวด (active ก่อน แล้วกลุ่ม "เลิกใช้แล้ว") — spec §1, §4
 * - แตะแถว active = เปิด sheet แก้ · แถวที่เลิกใช้แล้วอ่านอย่างเดียว + ปุ่ม "กู้คืน"
 * - optimistic: ชื่อ/สีขยับทันทีที่กดบันทึก · กู้คืนย้ายกลุ่มทันที · พลาด = rollback + ข้อความไทย
 */
export function CategoryList({ items }: { items: CategoryItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  /** null = ปิด · { item: null } = เพิ่มใหม่ · { item } = แก้ */
  const [sheet, setSheet] = useState<{ item: CategoryItem | null } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, CategoryPatch>>({});
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ข้อมูลใหม่จากเซิร์ฟเวอร์มาถึง = ทิ้งค่าที่ค้างอยู่
  useEffect(() => setOverrides({}), [items]);

  // เปิด sheet ตรง ๆ ด้วย ?new=1 หรือ ?edit=<id> (ใช้ถ่ายสกรีนช็อต/ทดสอบโดยไม่ต้องคลิก)
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

  const merge = (row: CategoryItem): CategoryItem => ({ ...row, ...overrides[row.id] });

  const optimistic = (id: string, patch: CategoryPatch) => {
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

  const restore = async (row: CategoryItem) => {
    setRestoring(row.id);
    setError(null);
    const rollback = optimistic(row.id, { archived: false });
    try {
      const result = await restoreCategoryAction(row.id);
      if (result.ok) {
        startTransition(() => router.refresh());
        return;
      }
      rollback();
      setError(result.message); // ชื่อชนกับตัว active → ข้อความไทยจาก action
    } catch {
      rollback();
      setError('กู้คืนไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
    } finally {
      setRestoring(null);
    }
  };

  const rows = items.map(merge);
  const { active, archived } = splitByArchived(rows);

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
        เพิ่มหมวด
      </button>

      {error ? (
        <p role="alert" className="text-[13px] leading-[18px] text-warn">
          ⚠ {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-card border border-border bg-surface p-4">
          <p className="text-text-muted">ยังไม่มีหมวด</p>
          <button
            type="button"
            onClick={() => setSheet({ item: null })}
            className="min-h-11 rounded-btn bg-balance px-4 font-bold text-on-accent"
          >
            เพิ่มหมวด
          </button>
        </div>
      ) : (
        <>
          <ul className="overflow-hidden rounded-card border border-border bg-surface">
            {active.map((row) => (
              <li key={row.id} className="border-b border-border last:border-b-0">
                <button type="button" onClick={() => setSheet({ item: row })} className={rowButtonClass}>
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-pill"
                    style={{ background: row.color ? `var(${row.color})` : 'var(--balance)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{row.name}</span>
                    <span className="block truncate text-[13px] leading-[18px] text-text-muted">
                      {CATEGORY_KIND_LABELS[row.kind]} · {row.usage} รายการ
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
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-pill"
                      style={{ background: row.color ? `var(${row.color})` : 'var(--balance)', opacity: 0.5 }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-text-muted">{row.name}</span>
                      <span className="block truncate text-[13px] leading-[18px] text-text-muted">
                        {CATEGORY_KIND_LABELS[row.kind]} · {row.usage} รายการ
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
        <CategorySheet
          item={sheet.item}
          onOptimistic={(patch) => optimistic(sheet.item?.id ?? 'new', patch)}
          onDone={done}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}
