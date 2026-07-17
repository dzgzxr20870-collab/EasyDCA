import { useState } from 'react';

function fmt(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-';
}

// ═══════════════════════════════════════════════════════════════════════
// UndoConfirmModal — ยืนยันก่อนยกเลิกรายการล่าสุด (งานที่ 2)
// ═══════════════════════════════════════════════════════════════════════
// เหตุผลที่ต้อง Confirm เสมอ (ตาม Requirement): POST /transactions/undo-last
// ยกเลิก "รายการล่าสุดของ User" ไม่ใช่ลบ id เจาะจง — ถ้ามีรายการใหม่แทรกระหว่างทาง
// (เปิดสองแท็บ / บันทึกผ่าน LINE คั่นกลาง) ตัวที่ถูกยกเลิกจริงอาจไม่ใช่ตัวที่การ์ด
// นี้แสดง (target = ค่าที่ Preview ไว้ตอนกดปุ่ม ไม่ใช่การยิง Preview API แยก — ไม่มี
// และไม่ควรมี Endpoint แบบนั้น) — เมื่อกดยืนยันแล้ว ให้ยึด Response จริงจาก Backend
// เป็นความจริงเสมอ (onConfirm คืนผลลัพธ์จริงให้ Caller แสดงต่อ ไม่ใช่ Modal นี้เดา)
//
// props:
//   target: { type:'buy'|'sell', symbol, amountTotal, currency, units?, pricePerUnit? } | null
//   onConfirm(): Promise — เรียก POST /transactions/undo-last จริง (Caller เป็นคนยิง)
//   onClose(): ปิด Modal (ยกเลิกการยกเลิก)
function UndoConfirmModal({ target, onConfirm, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!target) return null;

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      // onConfirm โยน Error ที่แปลเป็นไทยแล้ว (Caller ใช้ dcaErrors.undoErrorMessage)
      setError(err.message);
      setLoading(false);
      return;
    }
    setLoading(false);
  }

  return (
    <div className="dh-modal-overlay" onClick={() => !loading && onClose()}>
      <div className="dh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dh-modal-header">
          <h3>↩︎ ยืนยันยกเลิกรายการ</h3>
        </div>
        <div className="dh-modal-body">
          <p>คุณกำลังจะยกเลิก "รายการล่าสุด" ของคุณ:</p>
          <table className="dh-modal-summary">
            <tbody>
              <tr>
                <td>ประเภท</td>
                <td>{target.type === 'buy' ? 'ซื้อ' : 'ขาย'}</td>
              </tr>
              <tr>
                <td>สินทรัพย์</td>
                <td>{target.symbol}</td>
              </tr>
              <tr>
                <td>จำนวนเงิน</td>
                <td>
                  {fmt(target.amountTotal)} {target.currency}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="dh-modal-hint">
            * ระบบจะยกเลิก "รายการล่าสุดของคุณจริงๆ" ณ เวลาที่กดยืนยัน — ถ้ามีรายการอื่นถูกบันทึก
            แทรกเข้ามาก่อนหน้านี้ (เช่น ผ่าน LINE) ระบบจะแจ้งผลจริงให้ทราบหลังยืนยัน
          </p>
          {error && <p className="dh-modal-error">{error}</p>}
          <div className="dh-modal-actions">
            <button type="button" className="dh-btn-ghost" onClick={onClose} disabled={loading}>
              ไม่ยกเลิก
            </button>
            <button
              type="button"
              className="dh-btn-ghost dh-btn-ghost-danger"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? 'กำลังยกเลิก...' : 'ยืนยันยกเลิกรายการนี้'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UndoConfirmModal;
