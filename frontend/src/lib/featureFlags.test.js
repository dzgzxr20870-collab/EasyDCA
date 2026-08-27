// ═══════════════════════════════════════════════════════════════════════════
// featureFlags — ต้อง Fail-closed เสมอ
// ═══════════════════════════════════════════════════════════════════════════
// Flag นี้คุม Route `/app/*` ทั้งชุด และเป็น **สวิตช์ Rollback** ตัวเดียวของ Stage 9
// (ปิด Flag = ย้อนหน้าใหม่ทั้งหมดโดยไม่ต้อง Revert โค้ด)
//
// ⚠️ ความเสี่ยงจริงที่เทสต์ชุดนี้กัน: ค่าที่ "ดูเหมือนเปิด" แต่พิมพ์ไม่ตรง
// (`TRUE` / `1` / `yes` / `'true '` มีช่องว่างท้าย) ต้อง **ปิด** ไม่ใช่เปิด
// เพราะถ้าค่าพวกนี้เปิดได้ Flag จะเปิดเองจากการพิมพ์ผิดบน Railway โดยไม่มีใครตั้งใจ
// — และหน้าใหม่ที่ยังไม่ Verify จะถึงมือผู้ใช้จริงทันที
//
// ⚠️ ทิศทางของ Fail-closed สำคัญกว่าความสะดวก: "ตั้งค่าถูกแต่ไม่เปิด" คนตั้งเห็น
// แล้วแก้ได้ · "ตั้งค่าผิดแล้วเปิด" ไม่มีใครเห็นจนกว่าผู้ใช้จะเจอ

import { describe, test, expect, vi, afterEach } from 'vitest';
import { readFlag } from './featureFlags.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readFlag — Fail-closed', () => {
  test("'true' เป๊ะๆ เท่านั้นที่เปิด", () => {
    vi.stubEnv('VITE_TEST_FLAG', 'true');

    expect(readFlag('VITE_TEST_FLAG')).toBe(true);
  });

  test('ไม่ตั้งค่าเลย → ปิด (Default ที่ปลอดภัย)', () => {
    expect(readFlag('VITE_FLAG_THAT_DOES_NOT_EXIST')).toBe(false);
  });

  // ⭐ เคสสำคัญที่สุด — ค่าที่ "ดูเหมือนเปิด" ต้องไม่เปิด
  test.each(['TRUE', 'True', '1', 'yes', 'on', 'enabled', 'true ', ' true', ''])(
    '⭐ ค่า %o ต้องแปลว่า "ปิด" ไม่ใช่เปิด',
    (value) => {
      vi.stubEnv('VITE_TEST_FLAG', value);

      expect(readFlag('VITE_TEST_FLAG')).toBe(false);
    }
  );

  test("'false' → ปิด", () => {
    vi.stubEnv('VITE_TEST_FLAG', 'false');

    expect(readFlag('VITE_TEST_FLAG')).toBe(false);
  });

  // ⚠️ ต้องคืน boolean เสมอ ไม่ใช่ค่า truthy — Caller ใช้ใน JSX แบบ `{FLAG && <Route/>}`
  // ถ้าคืน string ว่าง React จะ Render ค่านั้นออกมาเป็นข้อความบนหน้าจอ
  test('คืน boolean เสมอ ไม่ใช่ค่า truthy/falsy ดิบ', () => {
    vi.stubEnv('VITE_TEST_FLAG', 'nope');

    expect(typeof readFlag('VITE_TEST_FLAG')).toBe('boolean');
  });
});
