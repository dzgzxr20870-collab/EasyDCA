import { describe, test, expect } from 'vitest';
import { investedAmount } from './dashboardStats.js';

describe('investedAmount — บั๊กที่ 3 (E2E Chrome Test): field mismatch totalThb', () => {
  // ⭐⭐ เคสที่พิสูจน์ว่าบั๊กถูกแก้จริง — ก่อนแก้ ฟังก์ชันนี้ (หรือ AppDashboard.jsx
  // เดิม) อ่าน .totalThb ที่ไม่มีจริงแล้วได้ null/undefined เสมอ
  test('⭐ Response จริงจาก dcaStats.service (amountByCurrency.THB) → อ่านค่าได้ถูก ไม่ใช่ null', () => {
    const summary = { count: 13, amountByCurrency: { THB: 2013400, USD: 0 } };

    expect(investedAmount(summary)).toEqual({ thb: 2013400, usd: 0 });
  });

  test('มี USD ปนด้วย → คืนแยกสกุล ไม่บวกข้ามสกุล', () => {
    const summary = { count: 5, amountByCurrency: { THB: 1000, USD: 300 } };

    expect(investedAmount(summary)).toEqual({ thb: 1000, usd: 300 });
  });

  test('ยังไม่เคยบันทึกเลย (count: 0) → thb เป็น 0 จริง ไม่ใช่ null (คนละความหมายกับ "ไม่มีข้อมูล")', () => {
    const summary = { count: 0, amountByCurrency: { THB: 0, USD: 0 } };

    expect(investedAmount(summary)).toEqual({ thb: 0, usd: 0 });
  });

  // Response ถูกตัดทอน/Endpoint เก่า/ยังโหลดไม่เสร็จ → ต้องไม่ throw และคืน null
  // ที่ Caller แยกแยะได้ว่า "ไม่มีข้อมูล" (ต่างจาก 0 ที่แปลว่า "มีข้อมูลแต่เป็นศูนย์")
  test('summary เป็น undefined → คืน { thb: null, usd: null } ไม่ throw', () => {
    expect(investedAmount(undefined)).toEqual({ thb: null, usd: null });
  });

  test('มี totalThb ค้างอยู่ (Field เก่าที่ไม่มีจริง) แต่ไม่มี amountByCurrency → ยังคืน null (ไม่หลงอ่าน Field ผิด)', () => {
    const summary = { count: 1, totalThb: 999 };

    expect(investedAmount(summary)).toEqual({ thb: null, usd: null });
  });
});
