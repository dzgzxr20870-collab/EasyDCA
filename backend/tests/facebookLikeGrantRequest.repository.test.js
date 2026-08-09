// facebookLikeGrantRequest.repository — findById / claimForReview
// ═══════════════════════════════════════════════════════════════════════════
// Security Audit (Cross-User Isolation, รอบ 2) — จุดสีส้ม 7-8/8
// ═══════════════════════════════════════════════════════════════════════════
// findById และ claimForReview เป็นจุดที่ "ข้าม User โดยเจตนา" (Admin ดู/เปลี่ยน
// สถานะคำขอของผู้ใช้คนอื่น) — ย้ายผ่าน queryAcrossUsers('...', 'admin') แทน
// supabaseAdmin ตรงๆ เพื่อให้ grep หาจุดข้าม User นี้เจอได้ทันที ไม่มี Test ตรง
// จุดนี้มาก่อนเลย (ไม่มีไฟล์นี้อยู่เดิม) เขียนใหม่ครอบทั้ง Guard + Happy Path
jest.mock('../src/config/supabase', () => {
  const { createClient } = require('./helpers/fakeSupabase');
  return { supabaseAdmin: createClient() };
});

const { supabaseAdmin } = require('../src/config/supabase');
const { tables, resetTables } = require('./helpers/fakeSupabase');
const requestRepository = require('../src/repositories/facebookLikeGrantRequest.repository');

beforeEach(() => {
  resetTables({
    facebook_like_grant_requests: [
      { id: 'req-1', user_id: 'user-a', status: 'pending', screenshot_path: 'p/a.jpg' },
      { id: 'req-2', user_id: 'user-b', status: 'pending', screenshot_path: 'p/b.jpg' },
    ],
  });
  supabaseAdmin.from.mockClear();
});

describe('findById — ข้าม User โดยเจตนา (Admin)', () => {
  test('Happy Path: Admin ดูคำขอของ User คนไหนก็ได้ (ไม่กรอง user_id)', async () => {
    const result = await requestRepository.findById('req-2');
    // ⚠️ ต้องเห็นคำขอของ user-b ได้ (Admin ไม่ใช่เจ้าของ) — พิสูจน์ว่า Cross-user จริง
    expect(result).toMatchObject({ id: 'req-2', userId: 'user-b' });
  });

  test('ไม่พบ id → คืน null', async () => {
    expect(await requestRepository.findById('no-such-id')).toBeNull();
  });

  test('reason ผิด Enum (ถ้ามีใครแก้ Signature ผิดในอนาคต) → throw INVALID_CROSS_USER_REASON', () => {
    // จำลองการเรียก queryAcrossUsers ตรงๆ ด้วย reason ที่ไม่ถูกต้อง เพื่อยืนยันว่า
    // Guard ของ Helper ทำงานจริง ไม่ใช่แค่ไม่ throw เพราะบังเอิญ
    const { queryAcrossUsers } = require('../src/utils/ownership.util');
    expect(() => queryAcrossUsers('facebook_like_grant_requests', 'not-a-real-reason')).toThrow(
      expect.objectContaining({ code: 'INVALID_CROSS_USER_REASON' })
    );
  });
});

describe('claimForReview — ข้าม User โดยเจตนา (Admin)', () => {
  test('Approve คำขอของ User คนอื่น (user-b) สำเร็จ — Admin ไม่ใช่เจ้าของแถวนี้เลย', async () => {
    const claimed = await requestRepository.claimForReview('req-2', {
      status: 'approved',
      reviewedBy: 'Uadmin1',
      now: new Date('2026-08-01T00:00:00.000Z'),
    });

    expect(claimed).toMatchObject({ id: 'req-2', userId: 'user-b', status: 'approved' });
  });

  test('Claim ไม่ได้ (Resolve ไปแล้ว) → คืน null', async () => {
    // Resolve ไปก่อนแล้ว (status ไม่ใช่ pending) → WHERE status='pending' ไม่ Match
    tables.facebook_like_grant_requests[1].status = 'approved';

    const claimed = await requestRepository.claimForReview('req-2', {
      status: 'rejected',
      reviewedBy: 'Uadmin1',
    });

    expect(claimed).toBeNull();
  });

  test('Reject พร้อมเหตุผล → บันทึก reject_reason', async () => {
    const claimed = await requestRepository.claimForReview('req-1', {
      status: 'rejected',
      reviewedBy: 'Uadmin1',
      rejectReason: 'รูปไม่ชัด',
    });

    expect(claimed).toMatchObject({ status: 'rejected', rejectReason: 'รูปไม่ชัด' });
  });
});
