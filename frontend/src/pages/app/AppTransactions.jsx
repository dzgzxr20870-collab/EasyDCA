import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiGet, apiPost } from '../../lib/api.js';
import { portfolioWriteState } from '../../lib/entitlements.js';
// ⚠️ api.js โยน Error(message = **Error Code ดิบ**) ไม่ใช่ข้อความไทย — ต้องแปลผ่าน
// ตารางกลางเสมอ ไม่งั้นผู้ใช้จะเห็น "ALREADY_UNDONE" โต้งๆ บนหน้าจอ
import { undoErrorMessage } from '../../lib/dcaErrors.js';

// ═══════════════════════════════════════════════════════════════════════════
// AppTransactions — ประวัติธุรกรรมต่อ API จริง (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// Port มาจาก `pages/demo/DemoTransactions.jsx` — ใช้ `GET /api/v1/dashboard/history`
//
// ⚠️ แสดง "ทุกแถวตามจริง" รวมรายการหักล้าง (Reversal) ด้วย — Ledger เป็น Immutable
// ผู้ใช้ต้องเห็นความจริงว่าเกิดอะไรขึ้นบ้าง ไม่ใช่ซ่อนคู่หักล้างให้ดูสะอาด
//
// ⭐ ปุ่ม "ย้อนรายการล่าสุด" ต้องกดได้เสมอแม้พอร์ตถูกล็อก (มติ Founder 24 ส.ค. 2569)
// เพราะ Undo คือ "แก้ให้ตรงความจริง" ไม่ใช่ "เพิ่มของใหม่"

const TYPE_LABEL = {
  buy: 'ซื้อ',
  sell: 'ขาย',
  dividend: 'ปันผล',
  dividend_reversal: 'ย้อนปันผล',
};

function formatAmount(n) {
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n ?? 0));
}

function AppTransactions() {
  const { selectedPortfolio, reload } = useOutletContext();
  const [transactions, setTransactions] = useState([]);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [undoing, setUndoing] = useState(false);
  const [undoMessage, setUndoMessage] = useState(null);

  const write = portfolioWriteState(selectedPortfolio);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = symbolFilter ? `?symbol=${encodeURIComponent(symbolFilter)}` : '';
      const data = await apiGet(`/api/v1/dashboard/history${qs}`);
      setTransactions(data?.transactions ?? []);
    } catch (err) {
      setError(err?.message ?? 'โหลดประวัติธุรกรรมไม่สำเร็จ');
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [symbolFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUndo() {
    setUndoing(true);
    setUndoMessage(null);
    setError(null);
    try {
      const res = await apiPost('/api/v1/transactions/undo-last', {});
      setUndoMessage(res?.message ?? 'ย้อนรายการล่าสุดเรียบร้อยแล้ว');
      await load();
      await reload?.();
    } catch (err) {
      // 🔴 เดิมโชว์ err.message ตรงๆ ซึ่งเป็น Error Code ดิบ — กดย้อนซ้ำรายการที่
      // ย้อนไปแล้วจึงขึ้นคำว่า "ALREADY_UNDONE" แทนที่จะเป็นข้อความที่อ่านรู้เรื่อง
      // (Backend มีข้อความไทยรออยู่แล้ว และ lib/dcaErrors ก็มีตารางเดียวกัน)
      setError(undoErrorMessage(err?.message));
    } finally {
      setUndoing(false);
    }
  }

  return (
    <section className="demo-page">
      <header className="demo-page__head">
        <h1>ธุรกรรม</h1>
        <label className="demo-field">
          <span>กรองตามสินทรัพย์</span>
          <input
            type="text"
            value={symbolFilter}
            placeholder="เช่น BTC"
            onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
          />
        </label>
      </header>

      {/* ⭐ canReduce เป็น true เสมอ — ปุ่มนี้ห้าม Disable เพราะพอร์ตถูกล็อก
          (Disable ได้เฉพาะตอนกำลังทำงาน หรือไม่มีรายการให้ย้อน) */}
      <div className="demo-actions">
        <button
          type="button"
          className="demo-btn"
          onClick={handleUndo}
          disabled={undoing || !write.canReduce || transactions.length === 0}
        >
          {undoing ? 'กำลังย้อนรายการ...' : '↩️ ย้อนรายการล่าสุด'}
        </button>
      </div>

      {write.isLocked && (
        <p className="app-note">
          พอร์ตนี้เพิ่มรายการใหม่ไม่ได้ แต่การย้อนรายการและบันทึกการขายยังทำได้ตามปกติ
        </p>
      )}

      {undoMessage && (
        <div className="app-state app-state--empty" role="status">
          {undoMessage}
        </div>
      )}

      {loading && (
        <div className="app-state app-state--loading" role="status">
          กำลังโหลดประวัติธุรกรรม...
        </div>
      )}

      {error && !loading && (
        <div className="app-state app-state--error" role="alert">
          <strong>เกิดข้อผิดพลาด</strong>
          <p>{error}</p>
          <button type="button" className="demo-btn" onClick={load}>
            ลองใหม่อีกครั้ง
          </button>
        </div>
      )}

      {!loading && !error && transactions.length === 0 && (
        <div className="app-state app-state--empty">
          <strong>ยังไม่มีธุรกรรม</strong>
          <p>
            {symbolFilter
              ? `ไม่พบรายการของ ${symbolFilter}`
              : 'เมื่อบันทึกรายการแรกแล้วจะแสดงที่นี่'}
          </p>
        </div>
      )}

      {!loading && !error && transactions.length > 0 && (
        <ul className="demo-txlist">
          {transactions.map((tx) => (
            <li key={tx.id} className="demo-txitem">
              <span className="demo-txitem__type">
                {/* ⚠️ type ที่ระบบยังไม่รู้จักต้องแสดงเป็นค่าดิบ **ห้าม Fallback เป็น
                    "ขาย"** (API.md ระบุไว้ชัด) — การเดาผิดทำให้ผู้ใช้อ่าน Ledger ผิด
                    ซึ่งเป็นบั๊กเดียวกับที่ Stage 6a ไล่แก้ทั้ง 8 จุด */}
                {TYPE_LABEL[tx.side ?? tx.type] ?? (tx.side ?? tx.type)}
              </span>
              <span className="demo-txitem__symbol">{tx.symbol}</span>
              <span className="demo-txitem__amount">
                {formatAmount(tx.amountTotal ?? tx.amountThb)} {tx.currency ?? 'บาท'}
              </span>
              <small>{tx.date}</small>
              {tx.hasSlip ? <small title="มีสลิปแนบ">📎</small> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default AppTransactions;
