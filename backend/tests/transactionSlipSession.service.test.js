jest.mock('../src/repositories/transactionSlipSession.repository');

const repo = require('../src/repositories/transactionSlipSession.repository');
const service = require('../src/services/transactionSlipSession.service');

// ═══════════════════════════════════════════════════════════════════════
// transactionSlipSession.service — Session "รอรูปสลิปของรายการที่เพิ่งบันทึก"
// ═══════════════════════════════════════════════════════════════════════
// โจทย์หลักที่ต้องพิสูจน์ (ตรงกับ 3 คำถามที่ Requirement บังคับให้ตอบ):
//   1) ไม่ส่งรูป (เงียบไป) ต้องไม่ค้างสถานะจนรูปถัดไปโดนแนบผิดรายการ → TTL ที่ชั้นอ่าน
//   2) ส่งรูปโดยไม่ได้อยู่ในสถานะนี้ ต้องเข้า OCR เหมือนเดิม → getActiveSession = null
//   3) ทุกฟังก์ชันต้อง Fail Isolated (ถูกเรียกหลัง Commit ธุรกรรมแล้ว ห้าม throw)
describe('transactionSlipSession.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('startWaiting', () => {
    it('เปิด Session สำเร็จ → คืน true', async () => {
      repo.upsert.mockResolvedValue({ userId: 'u1', transactionId: 'tx1' });

      await expect(service.startWaiting('u1', 'tx1')).resolves.toBe(true);
      expect(repo.upsert).toHaveBeenCalledWith('u1', 'tx1');
    });

    // ⚠️ ถูกเรียกหลังธุรกรรมถูก Commit ลง Ledger แล้ว — ถ้า throw ผู้ใช้จะเห็นว่า
    // "บันทึกไม่สำเร็จ" ทั้งที่สำเร็จแล้ว → กดซ้ำ → ธุรกรรมซ้ำใน Immutable Ledger
    it('DB ล่ม → คืน false ไม่ throw (Fail Isolated — ธุรกรรมบันทึกไปแล้ว)', async () => {
      repo.upsert.mockRejectedValue(new Error('db down'));

      await expect(service.startWaiting('u1', 'tx1')).resolves.toBe(false);
    });

    it('ไม่มี transactionId → ไม่เปิด Session และไม่ยิง DB', async () => {
      await expect(service.startWaiting('u1', undefined)).resolves.toBe(false);
      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getActiveSession — TTL บังคับที่ชั้นอ่านเสมอ', () => {
    it('ส่ง cutoff = now - TTL ให้ repository ทุกครั้ง (ไม่พึ่ง Cron ลบให้)', async () => {
      repo.findValidByUser.mockResolvedValue(null);
      const now = new Date('2026-08-22T10:00:00.000Z');

      await service.getActiveSession('u1', now);

      const expectedCutoff = new Date(now.getTime() - service.SESSION_TTL_MS).toISOString();
      expect(repo.findValidByUser).toHaveBeenCalledWith('u1', expectedCutoff);
    });

    it('มี Session ที่ยังไม่หมดอายุ → คืน Session (รูปจะถูกแนบเข้ารายการนั้น)', async () => {
      repo.findValidByUser.mockResolvedValue({ userId: 'u1', transactionId: 'tx-abc' });

      const result = await service.getActiveSession('u1');

      expect(result.transactionId).toBe('tx-abc');
    });

    // Requirement ข้อ 2: ส่งรูปโดยไม่ได้อยู่ในสถานะนี้ ต้องเข้า OCR เหมือนเดิมทุกประการ
    it('ไม่มี Session → คืน null (ผู้เรียกจะเดินเส้นทาง AI OCR เดิม)', async () => {
      repo.findValidByUser.mockResolvedValue(null);

      await expect(service.getActiveSession('u1')).resolves.toBeNull();
    });

    // ⚠️ Fail-open ตรงนี้โดยเจตนา (ต่างจาก slipOcrAccess ที่ Fail-closed):
    // แย่ที่สุดคือผู้ใช้เสียโควตา OCR 1 ครั้ง เบากว่าการส่งรูปไม่ได้เลยทั้งระบบ
    it('DB ล่ม → คืน null (Fail-open) ไม่ throw', async () => {
      repo.findValidByUser.mockRejectedValue(new Error('db down'));

      await expect(service.getActiveSession('u1')).resolves.toBeNull();
    });

    it('TTL เป็น 10 นาทีตามที่ออกแบบไว้ใน migration 040', () => {
      expect(service.SESSION_TTL_MS).toBe(10 * 60 * 1000);
    });
  });

  describe('stopWaiting', () => {
    it('ลบ Session ผ่าน repository', async () => {
      repo.deleteByUser.mockResolvedValue(undefined);

      await service.stopWaiting('u1');

      expect(repo.deleteByUser).toHaveBeenCalledWith('u1');
    });

    it('ลบไม่สำเร็จ → ไม่ throw (Best-effort)', async () => {
      repo.deleteByUser.mockRejectedValue(new Error('db down'));

      await expect(service.stopWaiting('u1')).resolves.toBeUndefined();
    });
  });

  describe('purgeStale', () => {
    // ต่างจากฟังก์ชันอื่น: ถูกเรียกจาก Cron ไม่ใช่จาก Flow ผู้ใช้ — Job ควรเห็น Error
    // จริงเพื่อ Alert ได้ (Job มี Error Isolation ของตัวเองอยู่แล้ว)
    it('ส่ง cutoff ให้ repository และคืนจำนวนที่ลบ', async () => {
      repo.purgeStaleBefore.mockResolvedValue(7);
      const now = new Date('2026-08-22T10:00:00.000Z');

      await expect(service.purgeStale(now)).resolves.toBe(7);

      const expectedCutoff = new Date(now.getTime() - service.SESSION_TTL_MS).toISOString();
      expect(repo.purgeStaleBefore).toHaveBeenCalledWith(expectedCutoff);
    });
  });
});
