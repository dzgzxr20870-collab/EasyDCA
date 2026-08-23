jest.mock('../src/repositories/broker.repository');

const brokerRepository = require('../src/repositories/broker.repository');
const brokerService = require('../src/services/broker.service');

// repository เป็น Automock — BrokerWriteError class หายไป ต้องประกาศเอง
// (Pattern เดียวกับ dcaPlans.controller.test.js ที่ต้องประกาศ DcaReminderError เอง)
class MockBrokerWriteError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BrokerWriteError';
    this.code = code;
    this.details = details;
  }
}
brokerRepository.BrokerWriteError = MockBrokerWriteError;

const USER_ID = 'user-1';

function broker(overrides = {}) {
  return {
    id: 'broker-1',
    userId: USER_ID,
    name: 'Bitkub',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  brokerRepository.findAllByUser.mockResolvedValue([]);
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeBrokerName — Pure Function (DoD ชั้น 1: Unit)
// ═══════════════════════════════════════════════════════════════════════════
// นี่คือจุดตัดสิน "ชื่อโบรกสองอันนี้คืออันเดียวกันไหม" ที่เดียวของทั้งระบบ
// ถ้าเพี้ยน กราฟโดนัท Broker Allocation จะแตกกลุ่มโดยที่ไม่มีใครรู้สาเหตุ
describe('normalizeBrokerName', () => {
  test('trim หัวท้าย และยุบช่องว่างซ้อนกันเหลือช่องเดียว', () => {
    expect(brokerService.normalizeBrokerName('  Bitkub  ').display).toBe('Bitkub');
    expect(brokerService.normalizeBrokerName('Inno  vest\tX').display).toBe('Inno vest X');
  });

  test('คงตัวพิมพ์ตามที่ผู้ใช้ตั้งใจไว้ใน display (ห้ามบังคับ Title Case)', () => {
    // "InnovestX" มีตัวพิมพ์ใหญ่กลางคำ — Title Case จะทำให้กลายเป็น "Innovestx"
    expect(brokerService.normalizeBrokerName('InnovestX').display).toBe('InnovestX');
    expect(brokerService.normalizeBrokerName('BITKUB').display).toBe('BITKUB');
  });

  test('key เป็นตัวพิมพ์เล็กเสมอ — "Bitkub"/"bitkub"/"BITKUB" ได้ key เดียวกัน', () => {
    const keys = ['Bitkub', 'bitkub', 'BITKUB', '  BiTkUb '].map(
      (n) => brokerService.normalizeBrokerName(n).key
    );
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('bitkub');
  });

  test('ชื่อภาษาไทยไม่ถูกเปลี่ยนรูป (ไทยไม่มี Case)', () => {
    const n = brokerService.normalizeBrokerName('บิทคับ');
    expect(n.display).toBe('บิทคับ');
    expect(n.key).toBe('บิทคับ');
  });

  test('คืน null สำหรับ Input ที่ใช้ไม่ได้ (Caller ต้องแปลงเป็น VALIDATION_ERROR)', () => {
    for (const bad of ['', '   ', '\t\n', null, undefined, 123, {}, [], true]) {
      expect(brokerService.normalizeBrokerName(bad)).toBeNull();
    }
  });

  test('ยาวเกินเพดาน 60 ตัวอักษร → null (ต้องตรงกับ CHECK ใน migration 042)', () => {
    const max = 'ก'.repeat(brokerService.BROKER_NAME_MAX_LENGTH);
    expect(brokerService.normalizeBrokerName(max)).not.toBeNull();
    expect(brokerService.normalizeBrokerName(`${max}ก`)).toBeNull();
  });

  test('นับความยาว "หลัง trim" ไม่ใช่ก่อน — ช่องว่างหัวท้ายไม่ควรทำให้ชื่อที่พอดีถูกปฏิเสธ', () => {
    const max = 'A'.repeat(brokerService.BROKER_NAME_MAX_LENGTH);
    expect(brokerService.normalizeBrokerName(`   ${max}   `)).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// createBroker
// ═══════════════════════════════════════════════════════════════════════════
describe('createBroker', () => {
  test('สร้างสำเร็จ — เก็บชื่อที่ Normalize แล้ว (ไม่ใช่ค่าดิบที่ผู้ใช้พิมพ์)', async () => {
    brokerRepository.create.mockResolvedValue(broker());

    await brokerService.createBroker(USER_ID, '  Bitkub  ');

    expect(brokerRepository.create).toHaveBeenCalledWith(USER_ID, 'Bitkub');
  });

  test('ชื่อว่าง/ยาวเกิน → VALIDATION_ERROR และ "ไม่ยิง Query เขียนเลย"', async () => {
    await expect(brokerService.createBroker(USER_ID, '   ')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(brokerRepository.create).not.toHaveBeenCalled();
  });

  test('ชื่อซ้ำแบบต่างตัวพิมพ์ → BROKER_NAME_EXISTS พร้อมบอกชื่อเดิมที่มีอยู่', async () => {
    brokerRepository.findAllByUser.mockResolvedValue([broker({ name: 'Bitkub' })]);

    // ผู้ใช้พิมพ์ "BITKUB" ทั้งที่ตัวเองเคยสร้าง "Bitkub" ไว้แล้ว — ต้องถูกกัน
    // ไม่งั้นกราฟโดนัทจะมี 2 กลุ่มที่เป็นโบรกเดียวกัน
    await expect(brokerService.createBroker(USER_ID, 'BITKUB')).rejects.toMatchObject({
      code: 'BROKER_NAME_EXISTS',
      details: { existingName: 'Bitkub', existingId: 'broker-1' },
    });
    expect(brokerRepository.create).not.toHaveBeenCalled();
  });

  test('Race: DB unique_violation หลุดขึ้นมา → แปลงเป็น BROKER_NAME_EXISTS ไม่ใช่ 500', async () => {
    // ชั้น Service เช็คแล้วว่า "ยังไม่มี" แต่มีอีก Request แทรกเข้ามาก่อน —
    // Unique Index คือด่านที่ Race ข้ามไม่ได้ ต้องแปลงเป็น Error ที่ผู้ใช้อ่านรู้เรื่อง
    brokerRepository.create.mockRejectedValue(
      new MockBrokerWriteError('BROKER_NAME_EXISTS', 'dup')
    );

    await expect(brokerService.createBroker(USER_ID, 'Bitkub')).rejects.toMatchObject({
      code: 'BROKER_NAME_EXISTS',
    });
  });

  test('Error ที่ไม่รู้จักต้องไม่ถูกกลบ (ระบบพังจริงต้องกลายเป็น 500)', async () => {
    brokerRepository.create.mockRejectedValue(new Error('connection reset'));

    await expect(brokerService.createBroker(USER_ID, 'Bitkub')).rejects.toThrow('connection reset');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// renameBroker
// ═══════════════════════════════════════════════════════════════════════════
describe('renameBroker', () => {
  test('เปลี่ยนชื่อสำเร็จ', async () => {
    brokerRepository.findByIdForUser.mockResolvedValue(broker());
    brokerRepository.findAllByUser.mockResolvedValue([broker()]);
    brokerRepository.updateName.mockResolvedValue(broker({ name: 'Binance' }));

    const result = await brokerService.renameBroker(USER_ID, 'broker-1', 'Binance');

    expect(result.name).toBe('Binance');
    // ลำดับอาร์กิวเมนต์: (brokerId, userId, name)
    expect(brokerRepository.updateName).toHaveBeenCalledWith('broker-1', USER_ID, 'Binance');
  });

  test('แก้แค่ตัวพิมพ์ของชื่อตัวเอง ("bitkub" → "Bitkub") ต้องทำได้ ไม่เด้ง EXISTS ใส่ตัวเอง', async () => {
    const own = broker({ name: 'bitkub' });
    brokerRepository.findByIdForUser.mockResolvedValue(own);
    brokerRepository.findAllByUser.mockResolvedValue([own]);
    brokerRepository.updateName.mockResolvedValue(broker({ name: 'Bitkub' }));

    await expect(brokerService.renameBroker(USER_ID, 'broker-1', 'Bitkub')).resolves.toMatchObject({
      name: 'Bitkub',
    });
  });

  test('เปลี่ยนไปชนชื่อโบรก "ตัวอื่น" ของตัวเอง → BROKER_NAME_EXISTS', async () => {
    brokerRepository.findByIdForUser.mockResolvedValue(broker({ id: 'broker-1', name: 'Bitkub' }));
    brokerRepository.findAllByUser.mockResolvedValue([
      broker({ id: 'broker-1', name: 'Bitkub' }),
      broker({ id: 'broker-2', name: 'Binance' }),
    ]);

    await expect(brokerService.renameBroker(USER_ID, 'broker-1', 'BINANCE')).rejects.toMatchObject({
      code: 'BROKER_NAME_EXISTS',
      details: { existingId: 'broker-2' },
    });
    expect(brokerRepository.updateName).not.toHaveBeenCalled();
  });

  test('id ที่ไม่ใช่ของ user → BROKER_NOT_FOUND และไม่ยิง UPDATE เลย', async () => {
    brokerRepository.findByIdForUser.mockResolvedValue(null);

    await expect(brokerService.renameBroker(USER_ID, 'broker-of-b', 'X')).rejects.toMatchObject({
      code: 'BROKER_NOT_FOUND',
    });
    expect(brokerRepository.updateName).not.toHaveBeenCalled();
  });

  test('ชื่อใหม่ไม่ถูกต้อง → VALIDATION_ERROR ก่อนแตะ DB', async () => {
    await expect(brokerService.renameBroker(USER_ID, 'broker-1', '')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(brokerRepository.findByIdForUser).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// deleteBroker
// ═══════════════════════════════════════════════════════════════════════════
describe('deleteBroker', () => {
  test('ลบสำเร็จคืน id ที่ลบ', async () => {
    brokerRepository.deleteByIdForUser.mockResolvedValue(1);

    await expect(brokerService.deleteBroker(USER_ID, 'broker-1')).resolves.toEqual({
      id: 'broker-1',
    });
  });

  test('ลบ 0 แถว (ไม่ใช่ของ user / ไม่มีจริง) → BROKER_NOT_FOUND', async () => {
    brokerRepository.deleteByIdForUser.mockResolvedValue(0);

    await expect(brokerService.deleteBroker(USER_ID, 'broker-of-b')).rejects.toMatchObject({
      code: 'BROKER_NOT_FOUND',
    });
  });
});
