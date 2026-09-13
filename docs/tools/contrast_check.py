#!/usr/bin/env python3
"""contrast_check.py — ตรวจคอนทราสต์ของ design tokens ใน docs/design.md ว่าผ่าน WCAG จริง

ใช้ (จากรากโปรเจกต์, ไม่ต้องตั้ง env, ไม่ต้องลงอะไรเพิ่ม — stdlib ล้วน):
  python3 docs/tools/contrast_check.py                     # ตรวจ docs/design.md (ค่าเริ่มต้น)
  python3 docs/tools/contrast_check.py path/อื่น.md        # ตรวจไฟล์อื่น
  python3 docs/tools/contrast_check.py --selftest          # พิสูจน์ว่าตัวตรวจจับค่าที่ตกเกณฑ์ได้
  python3 docs/tools/contrast_check.py --help

ขอบเขตที่ตรวจ (ดึงค่าจากตาราง §1.1 ของ design.md แล้วคำนวณสูตร WCAG เอง — ไม่มีตัวเลขฝังในสคริปต์)
  1. ข้อความบนพื้นธีม: --text, --text-muted, --income, --expense, --balance, --warn  >= 4.5:1 เทียบ --bg
  2. ข้อความเดียวกันบนการ์ด:                                                        >= 4.5:1 เทียบ --surface
  3. ขอบที่ต้องมองเห็น --border-strong:                                             >= 3:1 เทียบทั้ง --bg, --surface และ --surface-2
     (ช่องกรอกนั่งบน --surface-2 จึงต้องผ่านพร้อมกันทั้ง 3 พื้น — เคสที่เคยพลาดคือวัดเทียบแค่การ์ด)
  4. การ์ดไม่กลืนพื้น: --surface เทียบ --bg ของโหมดสว่าง                                >= 1.15:1
  5. เตือน (ไม่ fail) เมื่อ margin < 0.3 — ตัวที่จะหลุดก่อนถ้ามีคนขยับ --bg/--surface

ผ่านเมื่อ: ไม่มีบรรทัด FAIL · exit 0 (คำเตือน margin ไม่ทำให้ fail)
ไม่ผ่าน: exit 1 · ใช้ argument ผิด: exit 2
"""
import re
import sys
from pathlib import Path

DEFAULT_MD = Path(__file__).resolve().parents[2] / 'docs' / 'design.md'
TEXT_TOKENS = ['--text', '--text-muted', '--income', '--expense', '--balance', '--warn']
SCHEMES = [('light', 0), ('dark', 1)]
MARGIN_FLOOR = 0.3


def lum(hex_color: str) -> float:
    h = hex_color.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a: str, b: str) -> float:
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


def parse_tokens(md: str) -> dict:
    """อ่านตาราง §1.1 — รับ token -> (light hex, dark hex)"""
    tokens = {}
    for m in re.finditer(r'^\| `(--[a-z0-9-]+)` \| `(#[0-9A-Fa-f]{6})`[^|]*\| `(#[0-9A-Fa-f]{6})`', md, re.M):
        tokens[m.group(1)] = (m.group(2).upper(), m.group(3).upper())
    return tokens


def check(tokens: dict, quiet: bool = False) -> list:
    failures = []
    warns = []
    out = (lambda s: None) if quiet else print
    for scheme, idx in SCHEMES:
        bg = tokens['--bg'][idx]
        surface = tokens['--surface'][idx]
        surface2 = tokens['--surface-2'][idx]
        out(f'[{scheme}] bg {bg} · surface {surface} · surface-2 {surface2}')

        if scheme == 'light':
            layer = ratio(surface, bg)
            ok = layer >= 1.15
            if not ok:
                failures.append(f'{scheme} การ์ด:พื้น {layer:.3f} < 1.15')
            out(f'  การ์ด:พื้น = {layer:.3f} (ต้อง >= 1.15) ' + ('ok' if ok else 'FAIL'))

        for tok in TEXT_TOKENS:
            for base_name, base in (('--bg', bg), ('--surface', surface)):
                got = ratio(tokens[tok][idx], base)
                if got < 4.5:
                    failures.append(f'{scheme} {tok} บน {base_name} = {got:.3f} < 4.5')
                    status = 'FAIL'
                elif got - 4.5 < MARGIN_FLOOR:
                    warns.append(f'{scheme} {tok} บน {base_name} = {got:.3f} (margin {got - 4.5:+.3f})')
                    status = 'ok แต่ margin น้อย'
                else:
                    status = 'ok'
                out(f'  {tok:16s} บน {base_name:10s} = {got:.3f} (ต้อง >= 4.5) {status}')

        # ขอบที่ต้องมองเห็น: ต้องผ่านพร้อมกันทั้ง 3 พื้น (เคสจริงที่เคยพลาด: เทียบแค่ surface)
        for base_name, base in (('--bg', bg), ('--surface', surface), ('--surface-2', surface2)):
            got = ratio(tokens['--border-strong'][idx], base)
            if got < 3.0:
                failures.append(f'{scheme} --border-strong บน {base_name} = {got:.3f} < 3.0')
                status = 'FAIL'
            elif got - 3.0 < MARGIN_FLOOR:
                warns.append(f'{scheme} --border-strong บน {base_name} = {got:.3f} (margin {got - 3.0:+.3f})')
                status = 'ok แต่ margin น้อย'
            else:
                status = 'ok'
            out(f'  --border-strong  บน {base_name:10s} = {got:.3f} (ต้อง >= 3.0) {status}')
    return failures, warns


def tokens_from(md_path: Path) -> dict:
    md = md_path.read_text(encoding='utf-8')
    tokens = parse_tokens(md)
    needed = set(TEXT_TOKENS) | {'--bg', '--surface', '--surface-2', '--border-strong'}
    missing = needed - set(tokens)
    if missing:
        print('อ่านตาราง §1.1 ไม่ครบ ขาด: ' + ', '.join(sorted(missing)))
        sys.exit(2)
    return tokens


def main() -> int:
    argv = sys.argv[1:]
    if '--help' in argv or '-h' in argv:
        print(__doc__)
        return 0

    path = Path(next((a for a in argv if not a.startswith('-')), DEFAULT_MD))

    if '--selftest' in argv:
        # ใส่ค่าที่เคยตกเกณฑ์กลับเข้าไป (--border-strong ธีมมืด #5B6880 วัดเทียบ --surface-2 ได้ 2.79)
        tokens = tokens_from(path)
        before = tokens['--border-strong']
        tokens['--border-strong'] = (before[0], '#5B6880')
        failures, _ = check(tokens, quiet=True)
        caught = [f for f in failures if 'border-strong' in f and '--surface-2' in f]
        print(f'selftest: ใส่ --border-strong ธีมมืด = #5B6880 (ค่าเดิมที่ตกเกณฑ์) แล้วตัวตรวจรายงาน {len(failures)} ข้อ')
        print('  จับ border-strong ที่ตกเทียบ --surface-2 ได้ ' + ('ok' if caught else 'FAIL') + (f' ({caught[0]})' if caught else ''))
        ok = bool(caught)
        print('selftest ผ่าน — ตัวตรวจเชื่อได้' if ok else 'selftest ไม่ผ่าน — ห้ามใช้ตัวตรวจนี้ตัดสินงานจริง')
        return 0 if ok else 1

    tokens = tokens_from(path)
    print(f'ตรวจ: {path}\n')
    failures, warns = check(tokens)
    if warns:
        print('\nคำเตือน margin เหลือน้อย (ตัวที่จะหลุดก่อนถ้าขยับ --bg/--surface อีก):')
        for w in warns:
            print('  !', w)
    print()
    if failures:
        print('ไม่ผ่าน ' + str(len(failures)) + ' ข้อ:')
        for f in failures:
            print('  FAIL', f)
        return 1
    print('ผ่านทั้งหมด (ข้อความ >= 4.5 · ขอบ >= 3.0 ทั้ง 3 พื้น · การ์ด:พื้น >= 1.15)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
