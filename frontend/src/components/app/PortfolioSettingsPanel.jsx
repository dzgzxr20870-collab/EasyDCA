import { useState } from 'react';
import { updatePortfolio, deletePortfolio } from '../../lib/portfolioApi.js';
import { LOCKED_PORTFOLIO_NOTICE } from '../../lib/entitlements.js';

// ═══════════════════════════════════════════════════════════════════════════
// PortfolioSettingsPanel — เมนู "ตั้งค่าพอร์ต" รวม 3 ฟีเจอร์ (มติ Founder 30 ส.ค. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// รวมแก้ไขชื่อ / ย้ายสินทรัพย์ / ลบพอร์ต ไว้เมนูเดียว แทนปุ่ม "ย้ายพอร์ต" ที่เคย
// อยู่ท้ายทุกแถวในตาราง Holdings (ดูรก) — เปิดได้เฉพาะจากหน้ารายละเอียดพอร์ตที่
// เปิดดูอยู่เท่านั้น (AppPortfolio.jsx render เมื่อ `opened` เท่านั้น)
//
// ⚠️ **ไม่สร้าง Endpoint ใหม่เลย** — ใช้ 3 อย่างที่มีอยู่แล้วทั้งหมด:
//   แก้ชื่อ  → PATCH /portfolios/{id}  { name }        (portfolios.service.updatePortfolio)
//   ย้ายสินทรัพย์ → ส่งต่อให้ MoveAssetPortfolioDialog เดิม (PATCH /assets/{id})
//   ลบพอร์ต  → DELETE /portfolios/{id}                  (portfolios.service.deletePortfolio)
//
// ⚠️ **err.code ใช้ไม่ได้จริง** — ตรวจแล้วที่ lib/api.js: apiPatch/apiDelete ไม่เคย
// แนบ `.code` ให้ Error เลย มีแต่ `err.message` ที่ถูกตั้งเป็น Error Code ดิบจาก
// Backend ตรงๆ (Pattern เดียวกับที่ MoveAssetPortfolioDialog ใช้จริงอยู่แล้วผ่าน
// `err.message === 'ASSET_ALREADY_EXISTS'`) — ใช้ `err.message` เป็น Key เท่านั้น
//
// ⚠️ **สิทธิ์เขียนแยกกันคนละกฎต่อฟีเจอร์ในเมนูนี้** (ดู portfolios.service):
//   แก้ชื่อ    → ผ่าน assertCanAddToPortfolio → พอร์ตที่ถูกล็อก (canWrite:false)
//                แก้ไม่ได้ (PORTFOLIO_READ_ONLY) — LOCKED_PORTFOLIO_NOTICE.stillAllowed
//                ไม่มี "แก้ไขชื่อ" อยู่ในนั้น
//   ย้ายสินทรัพย์ → ไม่เช็คต้นทาง เช็คแค่ปลายทาง (MoveAssetPortfolioDialog กรอง
//                ปลายทางที่เขียนได้อยู่แล้ว) → ทำได้แม้พอร์ตนี้ถูกล็อก
//   ลบพอร์ต    → **ไม่ผ่าน assertCanAddToPortfolio โดยเจตนา** (ดู Comment ใน
//                deletePortfolio) → ทำได้แม้พอร์ตนี้ถูกล็อก เป็นทางออกจากพอร์ต
//                ที่ถูกล็อก ไม่ใช่ทางตัน

const NAME_MAX_LENGTH = 60; // ตรงกับ CHECK char_length(name) <= 60 (migration 044) — เลขเดียวกับ CreatePortfolioModal

export function renameErrorText(code, fallback) {
  const MAP = {
    VALIDATION_ERROR: `ชื่อพอร์ตต้องไม่เว้นว่างและยาวไม่เกิน ${NAME_MAX_LENGTH} ตัวอักษร`,
    PORTFOLIO_NOT_FOUND: 'ไม่พบพอร์ตนี้ อาจถูกลบไปแล้วจากอีกหน้าต่าง/อุปกรณ์',
    PORTFOLIO_READ_ONLY: `${LOCKED_PORTFOLIO_NOTICE.title} (${LOCKED_PORTFOLIO_NOTICE.reason}) — แก้ไขชื่อไม่ได้จนกว่าจะต่ออายุ`,
  };
  return MAP[code] ?? fallback ?? 'บันทึกชื่อพอร์ตไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

export function deleteErrorText(code, fallback) {
  const MAP = {
    PORTFOLIO_NOT_FOUND: 'ไม่พบพอร์ตนี้ อาจถูกลบไปแล้วจากอีกหน้าต่าง/อุปกรณ์',
    CANNOT_DELETE_DEFAULT_PORTFOLIO:
      'พอร์ตหลักลบไม่ได้ — ต้องตั้งพอร์ตอื่นเป็นพอร์ตหลักก่อน จึงจะลบพอร์ตนี้ได้',
    PORTFOLIO_HAS_CONFLICTING_ASSETS:
      'ลบไม่ได้ เพราะมีสินทรัพย์ในพอร์ตนี้ที่ซ้ำกับพอร์ตหลักอยู่แล้ว (Symbol + โบรกเดียวกัน) ' +
      'ระบบไม่รวมสองรายการให้อัตโนมัติเพราะกระทบต้นทุนเฉลี่ย — ให้ย้ายสินทรัพย์ที่ชนออกจากพอร์ตนี้ก่อน ' +
      '(ใช้เมนู "ย้ายสินทรัพย์" ด้านบน) แล้วค่อยลบพอร์ตนี้อีกครั้ง',
    DEFAULT_PORTFOLIO_MISSING: 'เกิดข้อผิดพลาดของระบบ (ไม่พบพอร์ตหลัก) กรุณาติดต่อผู้ดูแลระบบ',
  };
  return MAP[code] ?? fallback ?? 'ลบพอร์ตไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

// ป้ายกำกับ Asset ใน Dropdown — ต้องแยก Symbol เดียวกันต่างโบรกให้ออก
// (migration 046 — ถือ Symbol เดียวกันได้หลายโบรกในพอร์ตเดียว)
function assetOptionLabel(holding, brokers) {
  const brokerName = holding.brokerId
    ? ((brokers ?? []).find((b) => b?.id === holding.brokerId)?.name ?? 'ไม่ระบุ')
    : 'ไม่ระบุ';
  return `${holding.symbol} — ${brokerName}`;
}

function PortfolioSettingsPanel({
  portfolio,
  holdings = [],
  brokers = [],
  onClose,
  onRenamed,
  onMoveAsset,
  onDeleted,
}) {
  const [name, setName] = useState(portfolio.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState(null);

  const [selectedIdx, setSelectedIdx] = useState(holdings.length > 0 ? 0 : '');

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const trimmedName = name.trim();
  const nameTooLong = [...trimmedName].length > NAME_MAX_LENGTH;
  const canRename = portfolio.canWrite !== false;

  async function handleRename(e) {
    e.preventDefault();
    setNameError(null);

    if (!trimmedName) return setNameError('กรุณาตั้งชื่อพอร์ต');
    if (nameTooLong) return setNameError(renameErrorText('VALIDATION_ERROR'));
    if (trimmedName === portfolio.name) return; // ไม่มีอะไรเปลี่ยน ไม่ต้องยิง API

    setSavingName(true);
    try {
      const updated = await updatePortfolio(portfolio.id, { name: trimmedName });
      await onRenamed?.(updated);
    } catch (err) {
      setNameError(renameErrorText(err?.message, err?.message));
    } finally {
      setSavingName(false);
    }
  }

  function handleMoveClick() {
    if (selectedIdx === '' || !holdings[selectedIdx]) return;
    onMoveAsset?.(holdings[selectedIdx]);
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deletePortfolio(portfolio.id);
      await onDeleted?.(result);
    } catch (err) {
      setDeleteError(deleteErrorText(err?.message, err?.message));
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="app-modal-backdrop" role="dialog" aria-modal="true" aria-label="ตั้งค่าพอร์ต">
      <div className="app-modal">
        <header className="app-modal__head">
          <h2>⚙️ ตั้งค่าพอร์ต</h2>
          <button type="button" className="app-modal__close" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </header>

        <div className="app-modal__body">
          {/* ── แก้ไขชื่อพอร์ต ─────────────────────────────────────────── */}
          <section>
            <h3 className="app-settings__section-title">แก้ไขชื่อพอร์ต</h3>
            <form onSubmit={handleRename} className="demo-inline-row">
              <input
                type="text"
                value={name}
                maxLength={NAME_MAX_LENGTH}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                disabled={!canRename || savingName}
              />
              <button
                type="submit"
                className="demo-btn demo-btn--primary"
                disabled={!canRename || savingName || !trimmedName || nameTooLong}
              >
                {savingName ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </form>
            {!canRename && (
              <p className="app-note">
                {LOCKED_PORTFOLIO_NOTICE.title} ({LOCKED_PORTFOLIO_NOTICE.reason}) — แก้ไขชื่อไม่ได้จนกว่าจะต่ออายุ
              </p>
            )}
            {nameError && (
              <p className="app-state app-state--error" role="alert">
                {nameError}
              </p>
            )}
          </section>

          {/* ── ย้ายสินทรัพย์ ──────────────────────────────────────────── */}
          <section>
            <h3 className="app-settings__section-title">ย้ายสินทรัพย์ไปพอร์ตอื่น</h3>
            {holdings.length === 0 ? (
              <p className="app-note">ยังไม่มีสินทรัพย์ในพอร์ตนี้ให้ย้าย</p>
            ) : (
              <div className="demo-inline-row">
                <select value={selectedIdx} onChange={(e) => setSelectedIdx(Number(e.target.value))}>
                  {holdings.map((h, i) => (
                    <option key={`${h.symbol}|${h.brokerId ?? 'none'}`} value={i}>
                      {assetOptionLabel(h, brokers)}
                    </option>
                  ))}
                </select>
                <button type="button" className="demo-btn" onClick={handleMoveClick}>
                  ย้ายพอร์ต
                </button>
              </div>
            )}
          </section>

          {/* ── ลบพอร์ต ────────────────────────────────────────────────── */}
          <section>
            <h3 className="app-settings__section-title">ลบพอร์ตนี้</h3>

            {portfolio.isDefault ? (
              <div className="app-state app-state--warn">
                <strong>พอร์ตหลักลบไม่ได้</strong>
                <p>ต้องตั้งพอร์ตอื่นเป็นพอร์ตหลักก่อน จึงจะลบพอร์ตนี้ได้</p>
              </div>
            ) : !confirmingDelete ? (
              <button type="button" className="demo-btn demo-btn--danger" onClick={() => setConfirmingDelete(true)}>
                ลบพอร์ตนี้
              </button>
            ) : (
              <div className="app-state app-state--warn" role="alert">
                <strong>ยืนยันลบพอร์ต “{portfolio.name}”?</strong>
                <p>
                  การลบนี้ย้อนกลับไม่ได้ สินทรัพย์ที่อยู่ในพอร์ตนี้ (ถ้ามี) จะถูกย้ายไปรวมกับพอร์ตหลักอัตโนมัติ —
                  จำนวนที่ถือ ต้นทุน และประวัติธุรกรรมไม่เปลี่ยนแปลง
                </p>
                <div className="demo-actions">
                  <button
                    type="button"
                    className="demo-btn demo-btn--danger"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'กำลังลบ...' : 'ยืนยันลบพอร์ต'}
                  </button>
                  <button
                    type="button"
                    className="demo-btn"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={deleting}
                  >
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}

            {deleteError && (
              <p className="app-state app-state--error" role="alert">
                {deleteError}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default PortfolioSettingsPanel;
