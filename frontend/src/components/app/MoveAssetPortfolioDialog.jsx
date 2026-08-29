import { useState } from 'react';
import { updateAsset } from '../../lib/portfolioApi.js';

// ═══════════════════════════════════════════════════════════════════════════
// MoveAssetPortfolioDialog — ย้ายสินทรัพย์ไปพอร์ตอื่น (มติ Founder 29 ส.ค. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ **การย้ายพอร์ตไม่ใช่การซื้อ/ขาย** — ไม่มีธุรกรรมใหม่เกิดขึ้นใน Ledger
// แม้แต่แถวเดียว · จำนวนหน่วย ต้นทุน และโบรกเดิม **ไม่เปลี่ยนเลย** เปลี่ยนแค่
// `assets.portfolio_id` ซึ่งเป็นมิติสำหรับจัดกลุ่ม/แสดงผลล้วน
//
// ⭐ ใช้ `PATCH /api/v1/assets/{id}` ที่มีอยู่แล้ว **ไม่สร้าง Endpoint ใหม่**:
//   • assets.service ระบุไว้ชัดว่า "ไฟล์นี้ไม่แตะสูตรเงินเลยแม้แต่บรรทัดเดียว"
//   • ผ่าน assertCanAddToPortfolio อยู่แล้ว = ยืนยันเจ้าของพอร์ต (กัน IDOR)
//     **และ** เช็คสิทธิ์เขียนตอน Premium หมดอายุ (ย้ายเข้าพอร์ตที่ถูกล็อกไม่ได้
//     แต่ย้าย **ออก** ได้เสมอ — ไม่ขังสินทรัพย์เป็นตัวประกันค่าสมาชิก)
//   • ปฏิเสธ portfolioId = null อยู่แล้ว (Invariant migration 044/045)
// การสร้าง Endpoint ใหม่จะเป็นเส้นทางที่สองบนเส้นทางเงินที่ต้องดูแลด่านให้ครบซ้ำ
//
// ⚠️ พอร์ตปลายทางมี Symbol เดียวกันอยู่แล้ว → Backend ตอบ 409 ASSET_ALREADY_EXISTS
// (UNIQUE (user_id, symbol, portfolio_id, broker_id)) · **ไม่มีตัวเลือก "รวมให้"**
// เพราะการรวมสองแถวเข้าด้วยกันคือการรวมต้นทุนเฉลี่ยสองก้อน = แตะเงินจริง ซึ่ง
// POSTMORTEM_PORTFOLIO_RESOLUTION.md ระบุไว้ว่า "ห้าม AI ตัดสินเอง" และเป็น
// เหตุผลเดียวกับที่ deletePortfolio ปฏิเสธด้วย PORTFOLIO_HAS_CONFLICTING_ASSETS
// แทนการรวมให้อัตโนมัติ — ที่นี่จึงบอกทางออกที่ปลอดภัยแทนการรวมเงียบๆ

function MoveAssetPortfolioDialog({ holding, portfolios = [], currentPortfolioId, onClose, onMoved }) {
  // ปลายทางที่เลือกได้ = พอร์ตอื่นที่ **เขียนได้** เท่านั้น (พอร์ตที่ถูกล็อกจะโดน
  // PORTFOLIO_READ_ONLY อยู่ดี — ตัดออกตั้งแต่ต้นดีกว่าให้กดแล้วเจอ Error)
  const targets = (portfolios ?? []).filter(
    (p) => p.id !== currentPortfolioId && p.canWrite === true
  );

  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(false);

  const targetName = portfolios.find((p) => p.id === targetId)?.name ?? '';

  async function handleMove() {
    if (!targetId) return;
    setMoving(true);
    setError(null);
    setConflict(false);
    try {
      await updateAsset(holding.assetId, { portfolioId: targetId });
      await onMoved?.();
      onClose();
    } catch (err) {
      // ⚠️ แยกเคส "ปลายทางมีอยู่แล้ว" ออกมาอธิบายเป็นพิเศษ — ผู้ใช้ต้องเข้าใจว่า
      // ทำไมย้ายไม่ได้ และมีทางออกอะไรบ้าง ไม่ใช่เห็นข้อความ Error เฉยๆ
      if (err?.message === 'ASSET_ALREADY_EXISTS') {
        setConflict(true);
        return;
      }
      setError(err?.message ?? 'ย้ายพอร์ตไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="app-modal-backdrop" role="dialog" aria-modal="true" aria-label="ย้ายพอร์ต">
      <div className="app-modal">
        <header className="app-modal__head">
          <h2>ย้าย {holding.symbol} ไปพอร์ตอื่น</h2>
          <button type="button" className="app-modal__close" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </header>

        <div className="app-modal__body">
          {/* ⭐ ย้ำให้ชัดว่านี่ไม่ใช่การซื้อขาย — กันผู้ใช้เข้าใจผิดว่าตัวเลขจะเปลี่ยน */}
          <p className="app-note">
            การย้ายพอร์ต<strong>ไม่ใช่การซื้อหรือขาย</strong> — จำนวนหน่วย ต้นทุน และโบรกเดิมยังเท่าเดิมทุกอย่าง
            เปลี่ยนแค่ว่าสินทรัพย์นี้อยู่ในพอร์ตไหน
          </p>

          {targets.length === 0 ? (
            <div className="app-state app-state--empty">
              <strong>ยังไม่มีพอร์ตปลายทางให้ย้าย</strong>
              <p>ต้องมีพอร์ตอื่นที่เพิ่มรายการได้อย่างน้อย 1 พอร์ต</p>
            </div>
          ) : (
            <label className="demo-field">
              <span>ย้ายไปพอร์ต</span>
              <select
                value={targetId}
                onChange={(e) => {
                  setTargetId(e.target.value);
                  setConflict(false);
                  setError(null);
                }}
                disabled={moving}
              >
                {targets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.isDefault ? '⭐' : '🗂️'} {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* ⚠️ ปลายทางมี Symbol นี้อยู่แล้ว → **ไม่เสนอให้รวมอัตโนมัติ** เพราะการ
              รวมต้นทุนเฉลี่ยสองก้อนคือการแตะเงินจริง (ดูหัวไฟล์) — บอกทางออกที่
              ผู้ใช้ทำเองได้อย่างปลอดภัยแทน */}
          {conflict && (
            <div className="app-state app-state--warn" role="alert">
              <strong>ย้ายไม่ได้ เพราะพอร์ต {targetName} มี {holding.symbol} อยู่แล้ว</strong>
              <p>
                ระบบไม่รวมสองรายการให้อัตโนมัติ เพราะการรวมกระทบต้นทุนเฉลี่ยของทั้งสองก้อน —
                ต้องเป็นการตัดสินใจของคุณเอง
              </p>
              <p>เลือกพอร์ตปลายทางอื่น หรือถ้าตั้งใจจะรวมจริงๆ ให้บันทึกขายจากพอร์ตหนึ่งแล้วบันทึกซื้อในอีกพอร์ตหนึ่ง</p>
            </div>
          )}

          {error && (
            <p className="app-state app-state--error" role="alert">
              {error}
            </p>
          )}

          <div className="demo-actions">
            <button
              type="button"
              className="demo-btn demo-btn--primary"
              disabled={moving || !targetId || targets.length === 0}
              onClick={handleMove}
            >
              {moving ? 'กำลังย้าย...' : 'ย้ายพอร์ต'}
            </button>
            <button type="button" className="demo-btn" onClick={onClose} disabled={moving}>
              ยกเลิก
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MoveAssetPortfolioDialog;
