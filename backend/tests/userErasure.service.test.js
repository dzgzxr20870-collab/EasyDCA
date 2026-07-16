jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/payment.repository');
jest.mock('../src/services/storage.service');
jest.mock('../src/repositories/erasureLog.repository');

const userRepository = require('../src/repositories/user.repository');
const paymentRepository = require('../src/repositories/payment.repository');
const storageService = require('../src/services/storage.service');
const erasureLogRepository = require('../src/repositories/erasureLog.repository');
const userErasureService = require('../src/services/userErasure.service');

const USER_ID = 'user-1';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('eraseUserData', () => {
  test('มี Payment หลายรายการ → ลบสลิปทุก paymentId ก่อน Anonymize แล้วบันทึก Log ตามลำดับ', async () => {
    const callOrder = [];
    paymentRepository.findAllByUserId.mockImplementation(async () => {
      callOrder.push('findAllByUserId');
      return [{ id: 'pay-1' }, { id: 'pay-2' }];
    });
    storageService.deleteAllSlipsForUser.mockImplementation(async () => {
      callOrder.push('deleteAllSlipsForUser');
      return 3;
    });
    userRepository.anonymize.mockImplementation(async () => {
      callOrder.push('anonymize');
      return { id: USER_ID, anonymizedAt: '2026-07-17T00:00:00.000Z' };
    });
    erasureLogRepository.create.mockImplementation(async () => {
      callOrder.push('erasureLog.create');
      return { id: 'log-1' };
    });

    const result = await userErasureService.eraseUserData(USER_ID, { hadPendingPayment: true });

    expect(paymentRepository.findAllByUserId).toHaveBeenCalledWith(USER_ID);
    expect(storageService.deleteAllSlipsForUser).toHaveBeenCalledWith(['pay-1', 'pay-2']);
    expect(userRepository.anonymize).toHaveBeenCalledWith(USER_ID);
    expect(erasureLogRepository.create).toHaveBeenCalledWith({
      userId: USER_ID,
      hadPendingPayment: true,
    });
    // ลำดับต้องเป็น: หา Payment ก่อน → ลบสลิป → Anonymize → บันทึก Log (ไม่ใช่สลับกัน)
    expect(callOrder).toEqual([
      'findAllByUserId',
      'deleteAllSlipsForUser',
      'anonymize',
      'erasureLog.create',
    ]);
    expect(result).toEqual({ paymentCount: 2, deletedSlipCount: 3 });
  });

  test('ไม่มี Payment เลย → ยังคง Anonymize + บันทึก Log ได้ตามปกติ (deleteAllSlipsForUser รับ Array ว่าง)', async () => {
    paymentRepository.findAllByUserId.mockResolvedValue([]);
    storageService.deleteAllSlipsForUser.mockResolvedValue(0);
    userRepository.anonymize.mockResolvedValue({ id: USER_ID });
    erasureLogRepository.create.mockResolvedValue({ id: 'log-1' });

    const result = await userErasureService.eraseUserData(USER_ID, { hadPendingPayment: false });

    expect(storageService.deleteAllSlipsForUser).toHaveBeenCalledWith([]);
    expect(erasureLogRepository.create).toHaveBeenCalledWith({
      userId: USER_ID,
      hadPendingPayment: false,
    });
    expect(result).toEqual({ paymentCount: 0, deletedSlipCount: 0 });
  });

  test('hadPendingPayment default เป็น false ถ้าไม่ส่ง Option มาเลย', async () => {
    paymentRepository.findAllByUserId.mockResolvedValue([]);
    storageService.deleteAllSlipsForUser.mockResolvedValue(0);
    userRepository.anonymize.mockResolvedValue({ id: USER_ID });
    erasureLogRepository.create.mockResolvedValue({ id: 'log-1' });

    await userErasureService.eraseUserData(USER_ID);

    expect(erasureLogRepository.create).toHaveBeenCalledWith({
      userId: USER_ID,
      hadPendingPayment: false,
    });
  });

  // Log เขียนไม่สำเร็จ "หลัง" Anonymize จริงไปแล้ว — ต้องไม่ Throw ย้อนกลับ (User ข้อมูล
  // ถูกลบไปแล้วจริง จะ Fail ทั้ง Flow เพราะ Log พังไม่ได้ — Pattern เดียวกับ broadcast.service)
  test('erasureLogRepository.create ล้มเหลว → ไม่ Throw (Anonymize สำเร็จไปแล้วถือว่าจบ)', async () => {
    paymentRepository.findAllByUserId.mockResolvedValue([]);
    storageService.deleteAllSlipsForUser.mockResolvedValue(0);
    userRepository.anonymize.mockResolvedValue({ id: USER_ID });
    erasureLogRepository.create.mockRejectedValue(new Error('db blip'));

    await expect(userErasureService.eraseUserData(USER_ID)).resolves.toEqual({
      paymentCount: 0,
      deletedSlipCount: 0,
    });
    expect(userRepository.anonymize).toHaveBeenCalledWith(USER_ID);
  });

  test('storageService.deleteAllSlipsForUser ล้มเหลว → Throw ทันที ไม่ Anonymize User ต่อ', async () => {
    paymentRepository.findAllByUserId.mockResolvedValue([{ id: 'pay-1' }]);
    storageService.deleteAllSlipsForUser.mockRejectedValue(new Error('storage down'));

    await expect(userErasureService.eraseUserData(USER_ID)).rejects.toThrow('storage down');
    expect(userRepository.anonymize).not.toHaveBeenCalled();
  });

  test('userRepository.anonymize ล้มเหลว → Throw ทันที ไม่บันทึก Log', async () => {
    paymentRepository.findAllByUserId.mockResolvedValue([]);
    storageService.deleteAllSlipsForUser.mockResolvedValue(0);
    userRepository.anonymize.mockRejectedValue(new Error('db blip'));

    await expect(userErasureService.eraseUserData(USER_ID)).rejects.toThrow('db blip');
    expect(erasureLogRepository.create).not.toHaveBeenCalled();
  });
});
