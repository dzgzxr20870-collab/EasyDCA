import { useState } from 'react';
import { updateBroker, deleteBroker } from '../../lib/portfolioApi.js';

// ═══════════════════════════════════════════════════════════════════════════
// BrokerSettingsPanel — จัดการโบรก/Exchange ของผู้ใช้ (แก้ชื่อ/ลบ)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ โบรกเป็นของ "ผู้ใช้" ไม่ใช่ของพอร์ตใดพอร์ตหนึ่ง (assets.broker_id ผูกกับ
// user โดยตรง ไม่ผ่านพอร์ต — ดู broker.service.js) ต่างจาก PortfolioSettingsPanel
// ที่เปิดได้เฉพาะตอนดูพอร์ตหนึ่งอยู่ Panel นี้จึงเปิดได้จากทุกระดับของหน้า
// /app/portfolio (AppPortfolio.jsx) โดยไม่ผูกกับ `opened`
//
// ⚠️ **ไม่สร้าง Endpoint ใหม่เลย** — ใช้ที่มีอยู่แล้วทั้งหมด (Stage 1):
//   แก้ชื่อ → PATCH /brokers/{id} { name }   (brokers.controller.updateBroker)
//   ลบ     → DELETE /brokers/{id}            (brokers.controller.deleteBroker)
//
// ⚠️ ไม่มี "สร้างโบรกใหม่" ในนี้โดยเจตนา — สร้างได้อยู่แล้วตอนบันทึกธุรกรรม
// (RecordTransactionModal ใช้ createBroker) ไม่ใช่ขอบเขตของงานนี้ (แก้ไข/ลบเท่านั้น)
//
// ⭐ ตัวเลขจริงก่อนยืนยันลบ (Pattern เดียวกับ PortfolioSettingsPanel — Founder
// ทดสอบ UI Confirm 30 ส.ค. 2569): ใช้ `holdings` ที่หน้า AppPortfolio โหลดมาอยู่แล้ว
// ทั้งชุด (ทุกพอร์ตรวมกัน จาก GET /dashboard/portfolio) กรองด้วย brokerId **ไม่ยิง
// API เพิ่ม** เหมือนกันเป๊ะ — ข้อจำกัดเดียวกับพอร์ต: ตัดสินทรัพย์ที่ขายหมดแล้ว
// (heldQuantity <= 0) ออกไปแล้วตั้งแต่ Backend จึงอาจนับต่ำกว่าจำนวนแถวจริงใน DB
// เล็กน้อยถ้ามีสินทรัพย์ที่เคยผูกโบรกนี้แต่ขายหมดแล้ว — ยอมรับได้เพราะการลบโบรก
// เป็น Non-destructive อยู่แล้ว (แค่ตั้ง broker_id เป็น NULL ไม่ลบอะไร)

export function brokerRenameErrorText(code, fallback) {
  const MAP = {
    VALIDATION_ERROR: `ชื่อโบรกไม่ถูกต้อง — ต้องไม่เว้นว่างและยาวไม่เกิน 60 ตัวอักษร`,
    BROKER_NAME_EXISTS: 'คุณมีโบรกชื่อนี้อยู่แล้ว (ระบบถือว่าตัวพิมพ์ใหญ่-เล็กเป็นชื่อเดียวกัน)',
    BROKER_NOT_FOUND: 'ไม่พบโบรกนี้ อาจถูกลบไปแล้วจากอีกหน้าต่าง/อุปกรณ์',
  };
  return MAP[code] ?? fallback ?? 'บันทึกชื่อโบรกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

export function brokerDeleteErrorText(code, fallback) {
  const MAP = {
    BROKER_NOT_FOUND: 'ไม่พบโบรกนี้ อาจถูกลบไปแล้วจากอีกหน้าต่าง/อุปกรณ์',
  };
  return MAP[code] ?? fallback ?? 'ลบโบรกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

// สินทรัพย์ที่ผูกกับโบรกนี้อยู่ (จาก holdings ที่โหลดมาแล้วทั้งชุด — ทุกพอร์ตรวมกัน)
export function assetsForBroker(holdings, brokerId) {
  return (holdings ?? []).filter((h) => h?.brokerId === brokerId);
}

function fmtQty(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('th-TH', { maximumFractionDigits: 8 });
}

function BrokerSettingsPanel({ brokers = [], holdings = [], onClose, onRenamed, onDeleted }) {
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [renameError, setRenameError] = useState(null);

  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  function startEdit(broker) {
    setEditingId(broker.id);
    setEditName(broker.name);
    setRenameError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
    setRenameError(null);
  }

  async function handleRename(e, broker) {
    e.preventDefault();
    const trimmed = editName.trim();
    if (!trimmed) return setRenameError(brokerRenameErrorText('VALIDATION_ERROR'));
    if (trimmed === broker.name) return cancelEdit(); // ไม่มีอะไรเปลี่ยน ไม่ต้องยิง API

    setSavingId(broker.id);
    setRenameError(null);
    try {
      const updated = await updateBroker(broker.id, trimmed);
      cancelEdit();
      await onRenamed?.(updated);
    } catch (err) {
      setRenameError(brokerRenameErrorText(err?.message, err?.message));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(broker) {
    setDeletingId(broker.id);
    setDeleteError(null);
    try {
      const result = await deleteBroker(broker.id);
      setConfirmingId(null);
      await onDeleted?.(result);
    } catch (err) {
      setDeleteError(brokerDeleteErrorText(err?.message, err?.message));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="app-modal-backdrop" role="dialog" aria-modal="true" aria-label="จัดการโบรก">
      <div className="app-modal">
        <header className="app-modal__head">
          <h2>🏦 จัดการโบรก</h2>
          <button type="button" className="app-modal__close" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </header>

        <div className="app-modal__body">
          {brokers.length === 0 ? (
            <p className="app-note">
              ยังไม่มีโบรก/Exchange ที่บันทึกไว้ — เพิ่มได้ตอนบันทึกรายการซื้อ/ขาย
            </p>
          ) : (
            <ul className="app-brokerlist">
              {brokers.map((broker) => {
                const linkedAssets = assetsForBroker(holdings, broker.id);
                const isEditing = editingId === broker.id;
                const isConfirming = confirmingId === broker.id;

                return (
                  <li key={broker.id} className="app-brokerlist__item">
                    {isEditing ? (
                      <form onSubmit={(e) => handleRename(e, broker)} className="demo-inline-row">
                        <input
                          type="text"
                          value={editName}
                          maxLength={60}
                          onChange={(e) => {
                            setEditName(e.target.value);
                            setRenameError(null);
                          }}
                          disabled={savingId === broker.id}
                          autoFocus
                        />
                        <button
                          type="submit"
                          className="demo-btn demo-btn--primary"
                          disabled={savingId === broker.id || !editName.trim()}
                        >
                          {savingId === broker.id ? 'กำลังบันทึก...' : 'บันทึก'}
                        </button>
                        <button
                          type="button"
                          className="demo-btn"
                          onClick={cancelEdit}
                          disabled={savingId === broker.id}
                        >
                          ยกเลิก
                        </button>
                      </form>
                    ) : (
                      <div className="demo-inline-row">
                        <strong>{broker.name}</strong>
                        <button type="button" className="demo-btn" onClick={() => startEdit(broker)}>
                          แก้ไขชื่อ
                        </button>
                        {!isConfirming && (
                          <button
                            type="button"
                            className="demo-btn demo-btn--danger"
                            onClick={() => {
                              setConfirmingId(broker.id);
                              setDeleteError(null);
                            }}
                          >
                            ลบ
                          </button>
                        )}
                      </div>
                    )}

                    {renameError && editingId === broker.id && (
                      <p className="app-state app-state--error" role="alert">
                        {renameError}
                      </p>
                    )}

                    {/* ⭐ เห็นตัวเลขจริงก่อนกดยืนยัน (Pattern เดียวกับ
                        PortfolioSettingsPanel — deleteSummaryTotals หัวไฟล์นั้น) */}
                    {isConfirming && (
                      <div className="app-state app-state--warn" role="alert">
                        <strong>ยืนยันลบโบรก “{broker.name}”?</strong>
                        <p>
                          การลบนี้ย้อนกลับไม่ได้ สินทรัพย์ที่เคยผูกโบรกนี้ (ถ้ามี) ไม่ถูกลบตาม
                          — จะเปลี่ยนเป็น &quot;ไม่ระบุโบรก&quot; แทน จำนวนที่ถือ ต้นทุน และ
                          ประวัติธุรกรรมไม่เปลี่ยนแปลง
                        </p>

                        {linkedAssets.length > 0 ? (
                          <>
                            <p>สินทรัพย์ที่จะกลายเป็น &quot;ไม่ระบุโบรก&quot; ({linkedAssets.length} รายการ):</p>
                            <ul className="app-note">
                              {linkedAssets.map((h) => (
                                <li key={h.assetId ?? `${h.symbol}|${h.portfolioId ?? 'none'}`}>
                                  {h.symbol} — {fmtQty(h.heldQuantity)} หน่วย
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p>ไม่มีสินทรัพย์ที่ถืออยู่ผูกกับโบรกนี้ — ลบได้โดยไม่กระทบข้อมูลอื่น</p>
                        )}

                        <div className="demo-actions">
                          <button
                            type="button"
                            className="demo-btn demo-btn--danger"
                            onClick={() => handleDelete(broker)}
                            disabled={deletingId === broker.id}
                          >
                            {deletingId === broker.id ? 'กำลังลบ...' : 'ยืนยันลบโบรก'}
                          </button>
                          <button
                            type="button"
                            className="demo-btn"
                            onClick={() => setConfirmingId(null)}
                            disabled={deletingId === broker.id}
                          >
                            ยกเลิก
                          </button>
                        </div>

                        {deleteError && confirmingId === broker.id && (
                          <p className="app-state app-state--error" role="alert">
                            {deleteError}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default BrokerSettingsPanel;
