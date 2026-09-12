import type { MetadataRoute } from 'next';

// design.md §6 — theme_color ของ manifest มีค่าเดียวได้ จึงใช้ค่าโหมดสว่าง
// (แถบสถานะแยกตามธีมใช้อีกทาง: viewport.themeColor 2 ค่าใน app/layout.tsx)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'จดจ่าย',
    short_name: 'จดจ่าย',
    description: 'บันทึกรายรับรายจ่ายให้เสร็จในไม่กี่วินาที',
    start_url: '/',
    display: 'standalone',
    theme_color: '#EAEFF4',
    background_color: '#EAEFF4',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
