/** ผู้ทำรายการ — มาจาก session เท่านั้น (server action เป็นคนดึงแล้วส่งเข้ามา) ห้ามประกอบจาก input */
export type Session = { userId: string };
