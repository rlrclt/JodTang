'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createAuthClient } from 'better-auth/react';

/**
 * ฝั่ง client ของ Better Auth (design.md §4 S1/S6 · PLAN §3)
 * ใช้ baseURL ของหน้าปัจจุบันเอง (ค่าว่าง = origin + /api/auth) — ไม่ hardcode โดเมน/คีย์ในโค้ด
 */
const authClient = createAuthClient();

/** ผู้ให้บริการที่รองรับ — provider id ต้องตรงกับที่ตั้งไว้ใน src/lib/auth.ts ('google' · 'line') */
const PROVIDERS = [
  { id: 'google', label: 'ดำเนินการต่อด้วย Google' },
  { id: 'line', label: 'ดำเนินการต่อด้วย LINE' },
] as const;

type ProviderId = (typeof PROVIDERS)[number]['id'];

/** ข้อความ error แบบผู้ใช้อ่าน — ห้ามโชว์รหัส/ข้อความดิบของ provider (design.md §4) */
function messageFor(code: string | undefined): string {
  if (code === 'access_denied' || code === 'cancelled') return 'ยกเลิกการล็อกอินไปแล้ว ลองใหม่ได้เลย';
  return 'ล็อกอินไม่สำเร็จ ลองใหม่';
}

/**
 * ปุ่มล็อกอิน Google/LINE (design.md §2: สูง ≥44 · ใช้โทเคนสีเท่านั้น)
 * provider ที่ยังไม่มีคีย์ (GOOGLE_CLIENT_ID/LINE_CLIENT_ID ว่าง) → ปุ่ม disabled + บอกเหตุผลสั้น ๆ
 * ไม่ยิงคำขอ ไม่ทำหน้าเว็บพัง (src/lib/auth.ts อ่านคีย์จาก env อย่างเดียว)
 */
export function LoginButtons({ enabled }: { enabled: Record<ProviderId, boolean> }) {
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (provider: ProviderId) => {
    setBusy(provider);
    setError(null);
    try {
      // callbackURL = '/': กลับหน้าแรกหลังล็อกอินสำเร็จ (PLAN §3)
      const { error: failure } = await authClient.signIn.social({ provider, callbackURL: '/' });
      if (failure) setError(messageFor(failure.code));
    } catch {
      setError('ล็อกอินไม่สำเร็จ ลองใหม่');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {PROVIDERS.map((provider) => {
        const on = enabled[provider.id];
        return (
          <div key={provider.id} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => signIn(provider.id)}
              disabled={!on || busy !== null}
              className="min-h-14 w-full rounded-btn bg-balance px-4 font-semibold text-on-accent disabled:opacity-40"
            >
              {busy === provider.id ? 'กำลังพาไป…' : provider.label}
            </button>
            {on ? null : (
              <p className="text-[13px] leading-[18px] text-text-muted">
                ยังใช้ไม่ได้ — ยังไม่ได้ตั้งค่า {provider.id === 'google' ? 'GOOGLE_CLIENT_ID' : 'LINE_CLIENT_ID'}{' '}
                (ดูวิธีที่ docs/SETUP.md)
              </p>
            )}
          </div>
        );
      })}

      {/* error จากฝั่ง client (เน็ตหลุด/ป๊อปอัปถูกบล็อก) — มีปุ่มลองใหม่คือปุ่มด้านบน */}
      <p role="status" aria-live="polite" className="min-h-5 text-[13px] leading-[18px] text-warn">
        {error ?? ''}
      </p>
    </div>
  );
}

/** ออกจากระบบ — ปุ่มเดียวจบ ไม่ reload หน้า (design.md §2) */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await authClient.signOut();
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="min-h-11 rounded-btn border border-border-strong px-4 font-semibold disabled:opacity-40"
    >
      {busy ? 'กำลังออก…' : 'ออกจากระบบ'}
    </button>
  );
}
