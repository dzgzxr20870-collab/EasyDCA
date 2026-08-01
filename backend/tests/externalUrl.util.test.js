// ═══════════════════════════════════════════════════════════════════════════
// externalUrl.util — บังคับเปิดผ่าน Browser ภายนอก (ไม่ผ่าน liff.line.me)
// ═══════════════════════════════════════════════════════════════════════════
// พิสูจน์ 2 อย่างที่เป็นหัวใจของบั๊กนี้:
//   1) URL ที่สร้างต้อง "ไม่" เป็น liff.line.me เด็ดขาด (สาเหตุเดิมของปัญหา)
//   2) มี openExternalBrowser=1 ต่อท้ายเสมอ (พารามิเตอร์ที่ LINE Docs ยืนยันว่า
//      "ใช้ไม่ได้กับ liff.line.me" จึงต้องคู่กับ (1) เสมอ ไม่งั้นไม่มีผลอะไรเลย)

jest.mock('../src/config/env', () => ({
  app: { frontendUrl: null },
}));

const config = require('../src/config/env');
const { buildExternalUrl } = require('../src/utils/externalUrl.util');

describe('buildExternalUrl', () => {
  afterEach(() => {
    config.app.frontendUrl = null;
  });

  test('FRONTEND_URL ไม่ได้ตั้งค่า → null (Caller ต้องไม่ส่งปุ่ม uri ว่างๆ ต่อให้ LINE)', () => {
    expect(buildExternalUrl('/dashboard')).toBeNull();
  });

  test('ประกอบ URL จาก FRONTEND_URL + path ตรงๆ พร้อม openExternalBrowser=1', () => {
    config.app.frontendUrl = 'https://app.easydca.test';

    const url = buildExternalUrl('/dashboard');

    expect(url).toBe('https://app.easydca.test/dashboard?openExternalBrowser=1');
  });

  test('ไม่มี liff.line.me ปนอยู่เลยในผลลัพธ์ (สาเหตุเดิมของบั๊ก — ต้องไม่กลับมา)', () => {
    config.app.frontendUrl = 'https://app.easydca.test';

    const url = buildExternalUrl('/dashboard');

    expect(url).not.toContain('liff.line.me');
  });

  test('ใช้ได้กับหลาย Path (/support, /premium) ไม่ Hardcode Path เดียว', () => {
    config.app.frontendUrl = 'https://app.easydca.test';

    expect(buildExternalUrl('/support')).toBe('https://app.easydca.test/support?openExternalBrowser=1');
    expect(buildExternalUrl('/premium')).toBe('https://app.easydca.test/premium?openExternalBrowser=1');
  });

  test('FRONTEND_URL มี Trailing Slash → ไม่เกิด // ซ้ำในผลลัพธ์', () => {
    config.app.frontendUrl = 'https://app.easydca.test/';

    const url = buildExternalUrl('/dashboard');

    expect(url).toBe('https://app.easydca.test/dashboard?openExternalBrowser=1');
  });
});
