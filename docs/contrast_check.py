#!/usr/bin/env python3
"""ตรวจคอนทราสต์ของ design tokens ใน docs/design.md §1.1

รัน:  python3 docs/contrast_check.py        (exit 1 ถ้ามีตัวไหนไม่ผ่าน)
แก้ token ใน design.md แล้วต้องรันตัวนี้ก่อน commit — ตัวที่ margin น้อยสุดคือ
--balance บนพื้นสว่าง (เหลือ 0.13) ขยับ --bg/--surface แค่เล็กน้อยก็หลุด AA ได้
"""
import sys

LIGHT = dict(bg="#EAEFF4", surface="#FFFFFF", surface2="#F1F3F6", border="#E3E7ED",
             border_strong="#7E8794", text="#101828", text_muted="#616B7A",
             income="#157A3B", expense="#BE123C", balance="#0E7490", warn="#A64E07")
DARK = dict(bg="#0B1220", surface="#121B2C", surface2="#18233A", border="#24314D",
            border_strong="#5B6880", text="#E6EBF2", text_muted="#93A0B5",
            income="#4ADE80", expense="#FB7185", balance="#22D3EE", warn="#FBBF24")

TEXT_MIN = 4.5      # WCAG AA ข้อความปกติ (ทุกตัวในแอปนี้ตัวเล็กกว่า 18px)
BORDER_MIN = 3.0    # ขอบช่องกรอก/ปุ่มที่ต้องมองเห็น (non-text)
CARD_MIN = 1.15     # การ์ดต้องไม่กลืนพื้น (บทเรียน: เดิม 1.07 = จมหายบนจอจริง)
EDGE_MIN = 1.25     # โหมดมืดใช้เงาไม่ได้ → เส้นขอบต้องแยกการ์ดออกจากพื้นได้
MARGIN_WARN = 0.3   # เตือนเมื่อผ่านแบบเฉียดฉิว


def _lin(c):
    c /= 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def _lum(hexv):
    h = hexv.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def ratio(fg, bg):
    a, b = _lum(fg), _lum(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def check(name, tokens):
    fails, warns = [], []
    for t in ("text", "text_muted", "income", "expense", "balance", "warn"):
        for ground in ("bg", "surface"):
            r = ratio(tokens[t], tokens[ground])
            if r < TEXT_MIN:
                fails.append(f"{name}: --{t} บน --{ground} = {r:.2f} (< {TEXT_MIN})")
            elif r - TEXT_MIN < MARGIN_WARN:
                warns.append(f"{name}: --{t} บน --{ground} = {r:.2f} (margin {r - TEXT_MIN:+.2f})")
    r = ratio(tokens["border_strong"], tokens["surface"])
    if r < BORDER_MIN:
        fails.append(f"{name}: --border-strong บน --surface = {r:.2f} (< {BORDER_MIN})")
    # แยกชั้นได้ทางใดทางหนึ่งก็พอ: โหมดสว่างใช้การ์ดขาวบนพื้นเทา (surface:bg)
    # โหมดมืดใช้เงาไม่ได้ → แยกด้วยเส้นขอบ (border:surface) ตาม design.md §1.5
    card = ratio(tokens["surface"], tokens["bg"])
    edge = ratio(tokens["border"], tokens["surface"])
    if max(card / CARD_MIN, edge / EDGE_MIN) < 1:
        fails.append(f"{name}: การ์ดกลืนพื้น — surface:bg = {card:.2f} (< {CARD_MIN}) "
                     f"และ border:surface = {edge:.2f} (< {EDGE_MIN}) ไม่มีอะไรแยกชั้นเลย")
    return fails, warns


def main():
    fails, warns = [], []
    for name, tokens in (("light", LIGHT), ("dark", DARK)):
        f, w = check(name, tokens)
        fails += f
        warns += w
    print(f"light: การ์ดบนพื้น = {ratio(LIGHT['surface'], LIGHT['bg']):.2f}:1 · "
          f"dark: {ratio(DARK['surface'], DARK['bg']):.2f}:1")
    for w in warns:
        print("เตือน (margin < 0.3):", w)
    for f in fails:
        print("ไม่ผ่าน:", f)
    print("ผล:", "ผ่าน" if not fails else f"ไม่ผ่าน {len(fails)} ข้อ")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
