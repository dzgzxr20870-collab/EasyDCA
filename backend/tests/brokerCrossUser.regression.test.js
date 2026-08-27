// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION — Cross-User Isolation ของตาราง brokers (Stage 1, migration 042)
// ═══════════════════════════════════════════════════════════════════════════
// ที่มา: EasyDCA ใช้ Supabase ด้วย service_role key และ "ไม่ได้เปิด RLS" — Database
// ไม่ตรวจสิทธิ์ให้เลย ทุกการกันข้อมูลข้ามบัญชีอยู่ที่โค้ด Backend ล้วนๆ
// (PROJECT_STATUS.md กฎยืนข้อ 3) และ Audit เคยเจอช่องโหว่จริงบนเส้นทางเงินมาแล้ว
//
// ไฟล์นี้ครอบ "กับดักเฉพาะของ Feature Set นี้" (Design Doc § 6.3):
//   brokerId ที่มาจาก Request Body เป็นค่าที่ผู้ใช้กำหนดเองได้ 100% —
//   FK ระดับ DB ตรวจได้แค่ "broker แถวนี้มีอยู่จริง" **ไม่ได้ตรวจว่าเป็นของใคร**
//   ถ้าโค้ดไม่เทียบ user_id เอง ผู้ใช้ A ที่เดา/ถือ brokerId ของ B ได้ จะ:
//     - อ่านชื่อโบรกของ B ได้ (ข้อมูลส่วนตัวว่าใช้โบรกไหน = PII เชิงพฤติกรรม)
//     - เปลี่ยนชื่อโบรกของ B ได้
//     - ลบโบรกของ B ได้ (ทำให้สินทรัพย์ของ B กลายเป็น "ไม่ระบุโบรก" ทั้งหมด)
//     - ผูกสินทรัพย์ของตัวเองเข้ากับโบรกของ B ได้ (assertOwnedBrokerId)
//
// ── ทำไมต้อง Fake Supabase ที่ "บังคับ .eq() จริง" ─────────────────────────────
// ถ้า Mock Repository ทั้งชั้น เทสต์จะพิสูจน์ได้แค่ว่า "โค้ดส่ง userId ลงไป"
// ไม่ได้พิสูจน์ว่า "Query กรอง user_id จริง" — Mock ที่เราเขียนเองจะเห็นด้วยกับ
// Fix ของเราเสมอ (Test หลอกแบบที่ AI_WORK_POLICY § 6 เตือนไว้)
//
// ไฟล์นี้จึงใช้ Repository/Service "ตัวจริง" รันทับ Fake ที่ Implement Semantics
// ของ PostgREST ตามจริง → **ถ้าถอด queryForUser ออกแล้วใช้ supabaseAdmin.from()
// ตรงๆ เทสต์ในไฟล์นี้จะแดงทันที** (พิสูจน์ Red-Green จริงแล้ว — ดูรายงาน)
//
// ⚠️ ห้ามเปลี่ยน Fake ให้ "ยอมผ่าน" เพื่อให้เทสต์เขียว
// ═══════════════════════════════════════════════════════════════════════════

jest.mock('../src/config/supabase', () => {
  const { createClient } = require('./helpers/fakeSupabase');
  return { supabaseAdmin: createClient() };
});

const { tables, resetTables } = require('./helpers/fakeSupabase');

const brokerRepository = require('../src/repositories/broker.repository');
const brokerService = require('../src/services/broker.service');
const { OwnershipError } = require('../src/utils/ownership.util');

const USER_A = 'user-a-attacker';
const USER_B = 'user-b-victim';

// ชื่อโบรกของ B ตั้งให้จำเพาะพอที่จะค้นเจอถ้ามันหลุดไปโผล่ใน Response ของ A
const B_BROKER_NAME = 'InnovestX-ของ-B-ห้ามหลุด';
const B_BROKER_ID = 'broker-of-b';
const A_BROKER_ID = 'broker-of-a';

function seed() {
  resetTables({
    brokers: [
      {
        id: A_BROKER_ID,
        user_id: USER_A,
        name: 'Bitkub',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
      {
        id: B_BROKER_ID,
        user_id: USER_B,
        name: B_BROKER_NAME,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1) อ่าน — A ต้องไม่เห็นโบรกของ B ไม่ว่าจะทางไหน
// ═══════════════════════════════════════════════════════════════════════════
describe('brokers — ฝั่งอ่าน', () => {
  test('findAllByUser ของ A ไม่มีแถวของ B ปนมาเลย', async () => {
    const brokers = await brokerRepository.findAllByUser(USER_A);

    expect(brokers).toHaveLength(1);
    expect(brokers[0].id).toBe(A_BROKER_ID);
    // Assert เชิงเนื้อหาด้วย ไม่ใช่แค่เชิงจำนวน — ถ้าวันหนึ่งลำดับ/จำนวนเปลี่ยน
    // ด้วยเหตุอื่น เทสต์ยังต้องจับ "ชื่อของ B โผล่มา" ได้อยู่
    expect(JSON.stringify(brokers)).not.toContain(B_BROKER_NAME);
    expect(JSON.stringify(brokers)).not.toContain(USER_B);
  });

  test('findByIdForUser: A ถือ brokerId ของ B → คืน null (ไม่ใช่คืนแถวของ B)', async () => {
    const found = await brokerRepository.findByIdForUser(B_BROKER_ID, USER_A);
    expect(found).toBeNull();
  });

  test('findByIdForUser: เจ้าของจริงยังอ่านของตัวเองได้ปกติ (กัน Fix ที่ "ปลอดภัยเพราะพังทุกเคส")', async () => {
    const found = await brokerRepository.findByIdForUser(B_BROKER_ID, USER_B);
    expect(found).not.toBeNull();
    expect(found.name).toBe(B_BROKER_NAME);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) เขียน — A ต้องแก้/ลบโบรกของ B ไม่ได้ และแถวของ B ต้องไม่ถูกแตะแม้ Field เดียว
// ═══════════════════════════════════════════════════════════════════════════
describe('brokers — ฝั่งเขียน', () => {
  test('updateName: A พยายามเปลี่ยนชื่อโบรกของ B → ไม่สำเร็จ และแถวของ B เหมือนเดิมเป๊ะ', async () => {
    const before = { ...tables.brokers.find((r) => r.id === B_BROKER_ID) };

    const result = await brokerRepository.updateName(B_BROKER_ID, USER_A, 'ถูกยึดแล้ว');

    expect(result).toBeNull();
    const after = tables.brokers.find((r) => r.id === B_BROKER_ID);
    expect(after).toEqual(before);
    expect(after.name).toBe(B_BROKER_NAME);
  });

  test('deleteByIdForUser: A พยายามลบโบรกของ B → ลบ 0 แถว และแถวของ B ยังอยู่', async () => {
    const deleted = await brokerRepository.deleteByIdForUser(B_BROKER_ID, USER_A);

    expect(deleted).toBe(0);
    expect(tables.brokers.some((r) => r.id === B_BROKER_ID)).toBe(true);
    expect(tables.brokers).toHaveLength(2);
  });

  test('deleteByIdForUser: เจ้าของจริงลบของตัวเองได้ (พิสูจน์ว่าไม่ได้พังทุกเคส)', async () => {
    const deleted = await brokerRepository.deleteByIdForUser(B_BROKER_ID, USER_B);

    expect(deleted).toBe(1);
    expect(tables.brokers.some((r) => r.id === B_BROKER_ID)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) กับดักหลักของ Design Doc § 6.3 — assertOwnedBrokerId
// ═══════════════════════════════════════════════════════════════════════════
// นี่คือด่านที่ทุกจุดในอนาคตที่รับ brokerId จาก Body ต้องเรียกก่อนใช้ค่า
describe('assertOwnedBrokerId — ด่านกัน FK ข้ามบัญชี', () => {
  test('A อ้าง brokerId ของ B → โยน BROKER_NOT_FOUND (404 ไม่ใช่ 403)', async () => {
    await expect(brokerService.assertOwnedBrokerId(USER_A, B_BROKER_ID)).rejects.toMatchObject({
      code: 'BROKER_NOT_FOUND',
    });
  });

  test('Error ที่โยนออกไปต้องไม่มีข้อมูลของ B ติดไปด้วยแม้แต่ชื่อโบรก', async () => {
    let caught;
    try {
      await brokerService.assertOwnedBrokerId(USER_A, B_BROKER_ID);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    const leaked = `${caught.message} ${JSON.stringify(caught.details ?? {})}`;
    expect(leaked).not.toContain(B_BROKER_NAME);
    expect(leaked).not.toContain(USER_B);
  });

  test('A อ้าง brokerId ของตัวเอง → ผ่าน คืน id เดิม', async () => {
    await expect(brokerService.assertOwnedBrokerId(USER_A, A_BROKER_ID)).resolves.toBe(A_BROKER_ID);
  });

  test('null/undefined = "ไม่ระบุโบรก" → คืน null โดยไม่ยิง Query', async () => {
    await expect(brokerService.assertOwnedBrokerId(USER_A, null)).resolves.toBeNull();
    await expect(brokerService.assertOwnedBrokerId(USER_A, undefined)).resolves.toBeNull();
  });

  test('ค่าที่ไม่ใช่ String → VALIDATION_ERROR (ห้ามตีความเป็น null เงียบๆ)', async () => {
    // ห้าม Silent Default: ถ้า brokerId มาเป็น object/number จากบั๊กฝั่ง Client
    // แล้วโค้ดตีความว่า "ไม่ระบุโบรก" ผู้ใช้จะเห็นค่าที่ตั้งไว้หายไปเงียบๆ
    for (const bad of [123, {}, [], true, '   ']) {
      await expect(brokerService.assertOwnedBrokerId(USER_A, bad)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) โครงสร้างบังคับ ไม่ใช่วินัย — userId ที่หายไปต้อง "พังดัง" ไม่ใช่คืนของทุกคน
// ═══════════════════════════════════════════════════════════════════════════
describe('brokers — Guard ของ ownership.util', () => {
  test.each([
    ['findAllByUser', () => brokerRepository.findAllByUser(undefined)],
    ['findByIdForUser', () => brokerRepository.findByIdForUser(B_BROKER_ID, null)],
    ['create', () => brokerRepository.create('', 'X')],
    ['updateName', () => brokerRepository.updateName(B_BROKER_ID, undefined, 'X')],
    ['deleteByIdForUser', () => brokerRepository.deleteByIdForUser(B_BROKER_ID, null)],
  ])('%s: ไม่มี userId → throw MISSING_USER_ID (ไม่ใช่ Query ทั้งตาราง)', async (_name, run) => {
    await expect(run()).rejects.toBeInstanceOf(OwnershipError);
    // แถวของทุกคนต้องยังอยู่ครบ = ไม่มี Query อันตรายหลุดออกไปจริง
    expect(tables.brokers).toHaveLength(2);
  });

  test('brokers ถูกลงทะเบียนใน TABLE_REGISTRY แล้ว (ไม่งั้น queryForUser จะ throw UNKNOWN_TABLE)', () => {
    const { TABLE_REGISTRY } = require('../src/utils/ownership.util');
    expect(TABLE_REGISTRY.brokers).toEqual({ ownedColumn: 'user_id' });
  });
});
