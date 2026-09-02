import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { apiGet, apiPost } from '../../lib/api.js';
import { portfolioWriteState } from '../../lib/entitlements.js';
// ⚠️ api.js โยน Error(message = **Error Code ดิบ**) ไม่ใช่ข้อความไทย — ต้องแปลผ่าน
// ตารางกลางเสมอ ไม่งั้นผู้ใช้จะเห็น "ALREADY_UNDONE" โต้งๆ บนหน้าจอ
import { undoErrorMessage } from '../../lib/dcaErrors.js';
// ⭐ ป้ายกำกับแถว Reversal ในประวัติธุรกรรม (พรอมต์ 30 ส.ค. 2569) — แถวที่เกิดจาก
// กด "ยกเลิกรายการล่าสุด" ต้องแยกจากรายการซื้อ/ขายจริงด้วยสายตา ไม่ใช่แค่ปนกันไป
import { isReversalNote } from '../../lib/transactionNote.js';
// ⭐ เชื่อมโลโก้สินทรัพย์เข้าหน้าใหม่ (30 ส.ค. 2569) — Import ตรงจากตำแหน่งเดิม
// ห้าม Copy Logic ไปสร้างไฟล์ซ้ำใน components/app/
//
// ⚠️ **หน้านี้หา type ไม่ได้จริง** — GET /dashboard/history (transaction.repository
// .findAllByUser) Join แค่ `assets(symbol)` ไม่ได้ Join `type` มาด้วย และหน้านี้ไม่ได้
// ยิง /portfolio/allocation หรือ /dashboard/portfolio เลย (คนละหน้ากับ AppPortfolio/
// AppDashboard) จึงไม่มี type ให้ Flatten แบบ Pattern เดิม — ส่ง `undefined` ไปเฉยๆ
// ตามที่ Prompt อนุญาต (AssetAvatar Fallback เป็นตัวอักษรย่อ+สีได้เองอยู่แล้ว)
// ห้ามยิง Endpoint เพิ่มเพื่อเอา type มาเฉพาะจุดนี้ — รายงานให้ Founder ตัดสินใจแทน
// ว่าจะเพิ่ม Field type ที่ Backend (GET /dashboard/history) ทีหลังไหม
import AssetAvatar from '../../components/dashboard/AssetAvatar.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// AppTransactions — ประวัติธุรกรรมต่อ API จริง (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// Port มาจาก `pages/demo/DemoTransactions.jsx` — ใช้ `GET /api/v1/dashboard/history`
//
// ⚠️ แสดง "ทุกแถวตามจริง" รวมรายการหักล้าง (Reversal) ด้วย — Ledger เป็น Immutable
// ผู้ใช้ต้องเห็นความจริงว่าเกิดอะไรขึ้นบ้าง ไม่ใช่ซ่อนคู่หักล้างให้ดูสะอาด (แต่แถว
// เหล่านี้มีป้ายกำกับ + Style จางลงแยกจากรายการจริงด้วยสายตา — ดู isReversalNote)
//
// ⭐ ปุ่ม "ยกเลิกรายการล่าสุด" ต้องกดได้เสมอแม้พอร์ตถูกล็อก (มติ Founder 24 ส.ค.
// 2569) เพราะ Undo คือ "แก้ให้ตรงความจริง" ไม่ใช่ "เพิ่มของใหม่" — เดิมเรียกฟีเจอร์
// นี้ว่า "ย้อนรายการ" (fix/misleading-messages) แต่พรอมต์ 30 ส.ค. 2569 รวมคำใหม่
// ให้เป็น "ยกเลิกรายการล่าสุด" ทั้งเว็บและ LINE (ดู flexMessage.util.js คู่กัน)

const TYPE_LABEL = {
  buy: 'ซื้อ',
  sell: 'ขาย',
  dividend: 'ปันผล',
  dividend_reversal: 'ยกเลิกปันผล',
};

function formatAmount(n) {
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n ?? 0));
}

// จำนวนหน่วย — คนละ Precision กับเงิน (Crypto ทศนิยมได้ถึง 8 ตำแหน่ง)
function formatQty(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('th-TH', { maximumFractionDigits: 8 });
}

function AppTransactions() {
  const { selectedPortfolio, reload } = useOutletContext();
  const [transactions, setTransactions] = useState([]);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [undoing, setUndoing] = useState(false);
  const [undoMessage, setUndoMessage] = useState(null);
  // ── ⭐ ยืนยันก่อนยกเลิกรายการ (Founder ทดสอบ UI Confirm 30 ส.ค. 2569) ────────
  // null = ยังไม่ได้ถาม · object = รายการที่ "จะถูกยกเลิกจริง" ถ้ากดยืนยัน — เดิม
  // ปุ่มนี้กดครั้งเดียวจบไม่มี Confirm เลย ทั้งที่ยกเลิกรายการผิดตัวแก้คืนยาก
  // (ต้องยกเลิกซ้ำอีกที ซึ่งอาจกลายเป็นยกเลิกรายการอื่นต่อถ้ามีรายการใหม่แทรกเข้ามา)
  const [undoTarget, setUndoTarget] = useState(null);
  // กำลังโหลดรายการล่าสุดแบบไม่กรอง (เฉพาะตอนมี symbolFilter — ดู handleAskUndo)
  const [preparingUndo, setPreparingUndo] = useState(false);

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

  // ── ⭐ เตรียมข้อมูล Preview ก่อนถาม (Founder ทดสอบ UI Confirm 30 ส.ค. 2569) ──
  // POST /transactions/undo-last ย้อน "รายการล่าสุดของทั้งบัญชี" เสมอ ไม่รู้จัก
  // symbolFilter ของหน้านี้เลย (undoTransaction.service: findRecentByUser ไม่มี
  // Filter ใดๆ) — ถ้า Filter ใช้งานอยู่ transactions[0] ที่เห็นบนจออาจ **ไม่ใช่**
  // รายการที่จะถูกย้อนจริง ต้องยิงแบบไม่กรองมา Preview ให้ตรงเสมอ (มติ Founder:
  // ยอมแลก Extra Call เพื่อความปลอดภัย ดีกว่าโชว์ตัวเลขผิดรายการ)
  //
  // ⚠️ ไม่มี Filter → transactions[0] ตรงกับที่ Backend จะย้อนจริงเป๊ะอยู่แล้ว
  // (ORDER BY เดียวกัน: date DESC, created_at DESC ทั้ง findAllByUser ที่หน้านี้
  // ใช้ และ findRecentByUser ที่ undo-last ใช้) ไม่ต้องยิง Request เพิ่มเลย
  async function handleAskUndo() {
    setError(null);

    if (!symbolFilter) {
      setUndoTarget(transactions[0] ?? null);
      return;
    }

    setPreparingUndo(true);
    try {
      const data = await apiGet('/api/v1/dashboard/history?limit=1');
      setUndoTarget(data?.transactions?.[0] ?? null);
    } catch (err) {
      setError(err?.message ?? 'โหลดรายการล่าสุดไม่สำเร็จ');
    } finally {
      setPreparingUndo(false);
    }
  }

  async function handleUndo() {
    setUndoing(true);
    setUndoMessage(null);
    setError(null);
    try {
      const res = await apiPost('/api/v1/transactions/undo-last', {});
      setUndoMessage(res?.message ?? 'ยกเลิกรายการล่าสุดเรียบร้อยแล้ว');
      setUndoTarget(null);
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
          (Disable ได้เฉพาะตอนกำลังทำงาน หรือไม่มีรายการให้ยกเลิก) */}
      <div className="demo-actions">
        <button
          type="button"
          className="demo-btn"
          onClick={handleAskUndo}
          disabled={preparingUndo || undoing || !write.canReduce || transactions.length === 0}
        >
          {preparingUndo ? 'กำลังตรวจสอบ...' : '↩️ ยกเลิกรายการล่าสุด'}
        </button>
      </div>

      {/* ⭐ ยืนยันก่อนยกเลิกรายการ (Founder ทดสอบ UI Confirm 30 ส.ค. 2569) — เห็น
          รายละเอียดจริงของรายการที่จะถูกยกเลิกก่อนกดยืนยัน ไม่ใช่กดครั้งเดียวจบ */}
      {undoTarget && (
        <div
          className="app-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="ยืนยันยกเลิกรายการ"
        >
          <div className="app-modal">
            <header className="app-modal__head">
              <h2>ยืนยันยกเลิกรายการล่าสุด</h2>
            </header>
            <div className="app-modal__body">
              <p>ระบบจะยกเลิกรายการนี้ (สร้างรายการหักล้างเข้า Ledger ไม่ใช่ลบทิ้ง):</p>
              <ul className="app-note">
                <li>ประเภท: {TYPE_LABEL[undoTarget.side ?? undoTarget.type] ?? (undoTarget.side ?? undoTarget.type)}</li>
                <li>สินทรัพย์: {undoTarget.symbol}</li>
                <li>จำนวน: {formatQty(undoTarget.quantity)} หน่วย</li>
                <li>
                  ยอดเงิน: {formatAmount(undoTarget.amountTotal ?? undoTarget.amountThb)}{' '}
                  {undoTarget.currency ?? 'บาท'}
                </li>
                <li>วันที่: {undoTarget.date}</li>
              </ul>

              {error && (
                <p className="app-state app-state--error" role="alert">
                  {error}
                </p>
              )}

              <div className="demo-actions">
                <button
                  type="button"
                  className="demo-btn demo-btn--primary"
                  disabled={undoing}
                  onClick={handleUndo}
                >
                  {undoing ? 'กำลังยกเลิกรายการ...' : 'ยืนยันยกเลิกรายการ'}
                </button>
                <button
                  type="button"
                  className="demo-btn"
                  disabled={undoing}
                  onClick={() => setUndoTarget(null)}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {write.isLocked && (
        <p className="app-note">
          พอร์ตนี้เพิ่มรายการใหม่ไม่ได้ แต่การยกเลิกรายการและบันทึกการขายยังทำได้ตามปกติ
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
          {transactions.map((tx) => {
            // ⭐ แถวหักล้าง (จากกด "ยกเลิกรายการล่าสุด") ต้องแยกจากรายการซื้อ/ขาย
            // จริงด้วยสายตา — ไม่ซ่อน (ปรัชญาเดิมของหน้านี้) แค่ทำให้แยกแยะง่ายขึ้น
            // (พรอมต์ 30 ส.ค. 2569) note มาครบทุกแถวจาก GET /dashboard/history อยู่แล้ว
            const isReversal = isReversalNote(tx.note);
            return (
              <li
                key={tx.id}
                className={`demo-txitem${isReversal ? ' demo-txitem--reversal' : ''}`}
              >
                <span className="demo-txitem__type">
                  {/* ⚠️ type ที่ระบบยังไม่รู้จักต้องแสดงเป็นค่าดิบ **ห้าม Fallback เป็น
                      "ขาย"** (API.md ระบุไว้ชัด) — การเดาผิดทำให้ผู้ใช้อ่าน Ledger ผิด
                      ซึ่งเป็นบั๊กเดียวกับที่ Stage 6a ไล่แก้ทั้ง 8 จุด */}
                  {TYPE_LABEL[tx.side ?? tx.type] ?? (tx.side ?? tx.type)}
                </span>
                <span className="demo-txitem__symbol">
                  <AssetAvatar symbol={tx.symbol} type={undefined} />
                  {tx.symbol}
                  {isReversal && (
                    <small className="demo-txitem__badge" title="รายการนี้เกิดจากการกดยกเลิกรายการล่าสุด — ระบบสร้างรายการหักล้างเข้า Ledger ไม่ได้ลบรายการเดิม">
                      ↩︎ ยกเลิกรายการ
                    </small>
                  )}
                </span>
                <span className="demo-txitem__amount">
                  {formatAmount(tx.amountTotal ?? tx.amountThb)} {tx.currency ?? 'บาท'}
                </span>
                {/* ⭐ รวมวันที่ + ไอคอนสลิปเป็นกลุ่มเดียว (30 ส.ค. 2569) — ให้เป็น
                    Grid Cell เดียวที่นิยามได้ชัดเจน (.demo-txitem ใช้ CSS Grid 4
                    คอลัมน์) ไม่งั้นสองก้อนนี้จะหลุดไปเป็นคอลัมน์ที่ 5/6 แยกกัน
                    ทำให้แถวเอียงเมื่อบางรายการไม่มีสลิปแนบ */}
                <span className="demo-txitem__meta">
                  <small>{tx.date}</small>
                  {tx.hasSlip ? <small title="มีสลิปแนบ">📎</small> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default AppTransactions;
