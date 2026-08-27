jest.mock('../src/repositories/user.repository');
jest.mock('../src/repositories/payment.repository');
jest.mock('../src/services/storage.service');
jest.mock('../src/repositories/erasureLog.repository');
// PDPA (มติ Founder 27 ส.ค. 2569) — Erasure ล้างชื่อ portfolios/brokers ด้วย
// ⚠️ ไฟล์นี้เป็น Unit Test ของ "ลำดับการ Orchestrate" จึง Mock สองตัวนี้ทิ้ง
// ส่วนพฤติกรรมจริง (ชื่อต้องไม่ซ้ำ กันชน uniq_brokers_user_name_ci · Scope ด้วย
// user_id · Ledger ไม่ถูกแตะ) ถูกครอบด้วยของจริงที่
// tests/erasureAnonymizeLabels.regression.test.js
jest.mock('../src/repositories/portfolio.repository');
jest.mock('../src/repositories/broker.repository');

const userRepository = require('../src/repositories/user.repository');
const paymentRepository = require('../src/repositories/payment.repository');
const storageService = require('../src/services/storage.service');
const erasureLogRepository = require('../src/repositories/erasureLog.repository');
const portfolioRepository = require('../src/repositories/portfolio.repository');
const brokerRepository = require('../src/repositories/broker.repository');
const userErasureService = require('../src/services/userErasure.service');

const USER_ID = 'user-1';

beforeEach(() => {
  jest.clearAllMocks();
  // Default: การลบสลิปธุรกรรมสำเร็จโดยไม่มีไฟล์ (Test ที่สนใจเรื่องนี้ Override เอง)
  storageService.deleteAllTransactionSlipsForUser.mockResolvedValue(0);
  portfolioRepository.anonymizeNamesForUser.mockResolvedValue(0);
  brokerRepository.anonymizeNamesForUser.mockResolvedValue(0);
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
    storageService.deleteAllTransactionSlipsForUser.mockImplementation(async () => {
      callOrder.push('deleteAllTransactionSlipsForUser');
      return 2;
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
    expect(storageService.deleteAllTransactionSlipsForUser).toHaveBeenCalledWith(USER_ID);
    expect(userRepository.anonymize).toHaveBeenCalledWith(USER_ID);
    expect(erasureLogRepository.create).toHaveBeenCalledWith({
      userId: USER_ID,
      hadPendingPayment: true,
    });
    // ลำดับต้องเป็น: หา Payment → ลบสลิปชำระเงิน → ลบสลิปธุรกรรม → Anonymize → Log
    expect(callOrder).toEqual([
      'findAllByUserId',
      'deleteAllSlipsForUser',
      'deleteAllTransactionSlipsForUser',
      'anonymize',
      'erasureLog.create',
    ]);
    expect(result).toEqual({
      paymentCount: 2,
      deletedSlipCount: 3,
      deletedTransactionSlipCount: 2,
      // PDPA (มติ 27 ส.ค. 2569) — Erasure คืนจำนวนชื่อที่ล้างด้วย
      anonymizedPortfolioCount: 0,
      anonymizedBrokerCount: 0,
    });
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
    expect(result).toEqual({
      paymentCount: 0,
      deletedSlipCount: 0,
      deletedTransactionSlipCount: 0,
      // PDPA (มติ 27 ส.ค. 2569) — Erasure คืนจำนวนชื่อที่ล้างด้วย
      anonymizedPortfolioCount: 0,
      anonymizedBrokerCount: 0,
    });
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
      deletedTransactionSlipCount: 0,
      // PDPA (มติ 27 ส.ค. 2569) — Erasure คืนจำนวนชื่อที่ล้างด้วย
      anonymizedPortfolioCount: 0,
      anonymizedBrokerCount: 0,
    });
    expect(userRepository.anonymize).toHaveBeenCalledWith(USER_ID);
  });

  test('storageService.deleteAllSlipsForUser ล้มเหลว → Throw ทันที ไม่ Anonymize User ต่อ', async () => {
    paymentRepository.findAllByUserId.mockResolvedValue([{ id: 'pay-1' }]);
    storageService.deleteAllSlipsForUser.mockRejectedValue(new Error('storage down'));

    await expect(userErasureService.eraseUserData(USER_ID)).rejects.toThrow('storage down');
    expect(userRepository.anonymize).not.toHaveBeenCalled();
  });

  // สลิปธุรกรรม (S8) ต้อง Error Isolated — ต่างจากสลิปชำระเงินด้านบนที่ Throw หยุด Flow
  test('deleteAllTransactionSlipsForUser ล้มเหลว → ไม่ Throw, ยัง Anonymize + บันทึก Log ต่อ (Error Isolated)', async () => {
    paymentRepository.findAllByUserId.mockResolvedValue([]);
    storageService.deleteAllSlipsForUser.mockResolvedValue(0);
    storageService.deleteAllTransactionSlipsForUser.mockRejectedValue(
      new Error('transaction bucket down')
    );
    userRepository.anonymize.mockResolvedValue({ id: USER_ID });
    erasureLogRepository.create.mockResolvedValue({ id: 'log-1' });

    const result = await userErasureService.eraseUserData(USER_ID, { hadPendingPayment: false });

    // Flow ส่วนอื่นต้องทำงานต่อครบ แม้ลบสลิปธุรกรรมพัง
    expect(userRepository.anonymize).toHaveBeenCalledWith(USER_ID);
    expect(erasureLogRepository.create).toHaveBeenCalledWith({
      userId: USER_ID,
      hadPendingPayment: false,
    });
    // ลบไม่สำเร็จ → นับเป็น 0 (ไม่ใช่ค่าที่ Throw)
    expect(result).toEqual({
      paymentCount: 0,
      deletedSlipCount: 0,
      deletedTransactionSlipCount: 0,
      // PDPA (มติ 27 ส.ค. 2569) — Erasure คืนจำนวนชื่อที่ล้างด้วย
      anonymizedPortfolioCount: 0,
      anonymizedBrokerCount: 0,
    });
  });

  test('userRepository.anonymize ล้มเหลว → Throw ทันที ไม่บันทึก Log', async () => {
    paymentRepository.findAllByUserId.mockResolvedValue([]);
    storageService.deleteAllSlipsForUser.mockResolvedValue(0);
    userRepository.anonymize.mockRejectedValue(new Error('db blip'));

    await expect(userErasureService.eraseUserData(USER_ID)).rejects.toThrow('db blip');
    expect(erasureLogRepository.create).not.toHaveBeenCalled();
  });
});
