import { useState, useEffect, useCallback, useRef } from 'react';
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

// ตัวกรอง "ประเภทธุรกรรม" — ตรงตามที่ Prompt ระบุ (ซื้อ/ขาย/ปันผล/ทั้งหมด) ไม่รวม
// dividend_reversal เป็นตัวเลือกแยก (ยังกรองเจอได้ผ่าน "ปันผล" ไม่ได้ เพราะเป็นคนละ
// type — แถว Reversal ของ ซื้อ/ขาย ใช้ type เดิม สลับด้าน (undoTransaction.service
// reversalTypeFor) จึงกรองเจอได้ผ่าน "ซื้อ"/"ขาย" ตามปกติอยู่แล้ว ไม่ต้องมีตัวเลือก
// พิเศษ) ค่า '' = ไม่กรอง (ไม่ส่ง Query Param type ไปเลย)
const TYPE_FILTER_OPTIONS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'buy', label: 'ซื้อ' },
  { value: 'sell', label: 'ขาย' },
  { value: 'dividend', label: 'ปันผล' },
];

// เท่ากับ DEFAULT_HISTORY_LIMIT ฝั่ง Backend (dashboard.controller.js) — กำหนดชัดๆ
// ที่นี่แทนการพึ่ง Default ฝั่ง Backend เพื่อให้เลข Offset ของ "โหลดเพิ่ม" เดินตรง
// กับจำนวนที่ขอจริงเสมอ ไม่ผูกกับ Default ที่อาจเปลี่ยนได้ในอนาคต
const PAGE_SIZE = 50;

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

// ═══════════════════════════════════════════════════════════════════════════
// Pure Logic แยกออกมา Export ให้ Test ตรงได้ (Pattern เดียวกับ deleteSummaryTotals
// ของ PortfolioSettingsPanel / assetsForBroker ของ BrokerSettingsPanel) — หน้านี้
// เป็น Stateful Page ที่ต้องพึ่ง useOutletContext จึง Render ตรงๆ ด้วย
// renderToStaticMarkup ไม่ได้ (ไม่มี Router Context ให้) Logic ที่พลาดแล้วกระทบ
// ผู้ใช้จริง (Query String ที่ยิงจริง + ตัดสินใจว่า "มี Filter อยู่ไหม") จึงถูกดึง
// ออกมาเป็น Pure Function ทดสอบแยกแทน

// ประกอบ Query String ของ GET /dashboard/history จาก Filter ปัจจุบัน + offset ที่
// ต้องการ (offset ต่างกันระหว่าง "โหลดหน้าแรก" (0) กับ "โหลดเพิ่ม"
// (transactions.length) — ดู load()/handleLoadMore() ในคอมโพเนนต์)
export function buildHistoryQuery({ symbolFilter, typeFilter, dateFrom, dateTo, limit, offset }) {
  const params = new URLSearchParams();
  if (symbolFilter) params.set('symbol', symbolFilter);
  if (typeFilter) params.set('type', typeFilter);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return params.toString();
}

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ hasActiveFilter — ตัดสิน "ต้องยิง Request แยกเพื่อหารายการล่าสุดจริงไหม" ก่อน
// ยกเลิกรายการล่าสุด (ดู Comment เต็มที่ handleAskUndo ในคอมโพเนนต์)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ ต้องครอบ **ทั้ง 4 ตัวกรอง** (symbol/type/dateFrom/dateTo) — เดิมก่อนพรอมต์นี้
// เช็คแค่ symbolFilter ตัวเดียว ถ้าเพิ่ม Filter ใหม่ (type/dateFrom/dateTo) แล้วลืม
// เติมที่นี่ จะเกิดบั๊กเงียบ: ผู้ใช้กรอง "ขาย" อยู่ transactions[0] เป็นรายการขายที่
// เห็นบนจอ แต่ระบบยกเลิกรายการ "ล่าสุดของทั้งบัญชี" จริง (อาจเป็นรายการซื้อคนละตัว)
// ตาม Modal Confirm ที่โชว์ผิด — ผู้ใช้กดยืนยันโดยเข้าใจผิดว่ากำลังยกเลิกรายการที่เห็น
export function hasActiveFilter({ symbolFilter, typeFilter, dateFrom, dateTo }) {
  return Boolean(symbolFilter || typeFilter || dateFrom || dateTo);
}

function AppTransactions() {
  const { selectedPortfolio, reload } = useOutletContext();
  const [transactions, setTransactions] = useState([]);
  // จำนวนรายการที่ตรงเงื่อนไข Filter ปัจจุบันทั้งหมด (จาก Backend — Exact Count)
  // ต่างจาก transactions.length ที่เป็น "จำนวนที่โหลดมาแล้วสะสม" — ใช้คู่กันตัดสิน
  // ว่ายังมี "โหลดเพิ่ม" ให้กดไหม (ดู hasMore ด้านล่าง)
  const [total, setTotal] = useState(0);
  const [symbolFilter, setSymbolFilter] = useState('');
  // ตัวกรองใหม่ (Prompt: ตัวกรองเพิ่มเติมในหน้าประวัติธุรกรรม) — ทุกตัวส่งเป็น Query
  // Param ตรงๆ ให้ GET /dashboard/history กรองที่ DB จริง (ไม่ใช่กรองฝั่ง Client)
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [undoing, setUndoing] = useState(false);
  const [undoMessage, setUndoMessage] = useState(null);
  // ── ⭐ ยืนยันก่อนยกเลิกรายการ (Founder ทดสอบ UI Confirm 30 ส.ค. 2569) ────────
  // null = ยังไม่ได้ถาม · object = รายการที่ "จะถูกยกเลิกจริง" ถ้ากดยืนยัน — เดิม
  // ปุ่มนี้กดครั้งเดียวจบไม่มี Confirm เลย ทั้งที่ยกเลิกรายการผิดตัวแก้คืนยาก
  // (ต้องยกเลิกซ้ำอีกที ซึ่งอาจกลายเป็นยกเลิกรายการอื่นต่อถ้ามีรายการใหม่แทรกเข้ามา)
  const [undoTarget, setUndoTarget] = useState(null);
  // กำลังโหลดรายการล่าสุดแบบไม่กรอง (เฉพาะตอนมี Filter ใดๆ ทำงานอยู่ — ดู handleAskUndo)
  const [preparingUndo, setPreparingUndo] = useState(false);

  const write = portfolioWriteState(selectedPortfolio);

  // ── 🔴 บั๊กที่แก้ (E2E Chrome Test — บั๊กที่ 2): กรอง Symbol พังสนิท ──────────
  // Root Cause จริง (ยืนยันด้วย Network Capture): **ไม่ใช่** Backend กรองผิด และ
  // **ไม่ใช่** Client เทียบ Symbol ผิด (สองข้อนี้ตรวจแล้วถูกต้องทั้งคู่) — เป็น
  // Race Condition ล้วนๆ: พิมพ์ทีละตัวอักษร (ไม่มี Debounce) → ทุก Keystroke ยิง
  // `apiGet` ใหม่ทันที (symbolFilter เปลี่ยน → `load` ถูกสร้างใหม่ → Effect ทำงาน)
  // โดยไม่มีการยกเลิก/เพิกเฉย Response ของคำขอก่อนหน้าเลย — ถ้า Response ของ
  // Keystroke ก่อนๆ (เช่น "EOS" ที่ไม่ตรง Symbol ไหนเลย → ได้ [] กลับมา) ตอบกลับมา
  // **หลัง** Response ของคำขอล่าสุดที่ถูกต้อง (เช่น "EOSE") ผลลัพธ์ที่ถูกต้องจะถูก
  // เขียนทับด้วย [] ทันที — ผู้ใช้จึงเห็น "ไม่พบรายการ" แม้ Backend ตอบข้อมูลถูก
  // ต้องมาจริง (พิสูจน์ด้วยการดักจับ Response ตรงๆ: /history?symbol=EOSE คืน 8
  // รายการ แต่ /history?symbol=EOS ที่ยิงไปก่อนหน้ากลับตอบ **ทีหลัง** แล้วเขียนทับ)
  //
  // ⚠️ แก้ด้วย Sequence Guard (Pattern เดียวกับ `alive` flag ของ
  // RecordTransactionModal.jsx's useEffect) — นับเลขคำขอ แล้ว apply เฉพาะ
  // Response ของคำขอที่ "ล่าสุดจริง" ตาม **ลำดับที่ส่งออกไป** เท่านั้น ไม่ใช่ตาม
  // ลำดับที่ตอบกลับมา
  const requestSeqRef = useRef(0);

  // offset ต่างกันระหว่าง "โหลดหน้าแรก" (0, เรียกจาก load()) กับ "โหลดเพิ่ม"
  // (transactions.length, เรียกจาก handleLoadMore()) — Filter ชุดเดียวกันเป๊ะ
  function queryFor(offset) {
    return buildHistoryQuery({ symbolFilter, typeFilter, dateFrom, dateTo, limit: PAGE_SIZE, offset });
  }

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const qs = queryFor(0);
      const data = await apiGet(`/api/v1/dashboard/history?${qs}`);
      if (seq !== requestSeqRef.current) return; // มีคำขอใหม่กว่าแซงไปแล้ว — เพิกเฉย
      setTransactions(data?.transactions ?? []);
      setTotal(data?.total ?? 0);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err?.message ?? 'โหลดประวัติธุรกรรมไม่สำเร็จ');
      setTransactions([]);
      setTotal(0);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [symbolFilter, typeFilter, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  // ── "โหลดเพิ่ม" (Pagination) — ต่อท้ายรายการที่มีอยู่ ไม่แทนที่ ─────────────────
  // ใช้ transactions.length ปัจจุบันเป็น offset ของหน้าถัดไปตรงๆ — ถูกเสมอเพราะ
  // Backend เรียง date DESC, created_at DESC แบบ Deterministic (ดู
  // transaction.repository.findFilteredByUser) จำนวนที่โหลดมาแล้วเท่ากับ Offset ที่
  // ต้องขอต่อพอดี ไม่ต้องเก็บ State offset แยกให้ Sync พลาดกันได้
  //
  // ⚠️ ใช้ requestSeqRef ร่วมกับ load() โดยเจตนา — ถ้าผู้ใช้เปลี่ยน Filter ระหว่างที่
  // "โหลดเพิ่ม" ค้างอยู่ load() ใหม่จะขยับ Seq ขึ้นไปอีก ทำให้ Response ของโหลดเพิ่ม
  // รอบเก่า (ที่อ้าง Filter ชุดเดิม) ถูกเพิกเฉยแทนที่จะไปต่อท้ายรายการของ Filter ใหม่
  async function handleLoadMore() {
    const seq = ++requestSeqRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const qs = queryFor(transactions.length);
      const data = await apiGet(`/api/v1/dashboard/history?${qs}`);
      if (seq !== requestSeqRef.current) return;
      setTransactions((prev) => [...prev, ...(data?.transactions ?? [])]);
      setTotal(data?.total ?? total);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err?.message ?? 'โหลดเพิ่มไม่สำเร็จ');
    } finally {
      if (seq === requestSeqRef.current) setLoadingMore(false);
    }
  }

  const hasMore = !loading && transactions.length < total;

  // ── ⭐ เตรียมข้อมูล Preview ก่อนถาม (Founder ทดสอบ UI Confirm 30 ส.ค. 2569) ──
  // POST /transactions/undo-last ย้อน "รายการล่าสุดของทั้งบัญชี" เสมอ ไม่รู้จัก
  // Filter ใดๆ ของหน้านี้เลย (undoTransaction.service: findRecentByUser ไม่มี
  // Filter ใดๆ) — ถ้า Filter ใดใน 4 ตัว (symbol/type/dateFrom/dateTo) ใช้งานอยู่
  // transactions[0] ที่เห็นบนจออาจ **ไม่ใช่** รายการที่จะถูกย้อนจริง ต้องยิงแบบไม่
  // กรองมา Preview ให้ตรงเสมอ (มติ Founder: ยอมแลก Extra Call เพื่อความปลอดภัย
  // ดีกว่าโชว์ตัวเลขผิดรายการ)
  //
  // ⚠️ ไม่มี Filter ตัวไหนเลย → transactions[0] ตรงกับที่ Backend จะย้อนจริงเป๊ะอยู่
  // แล้ว (ORDER BY เดียวกัน: date DESC, created_at DESC ทั้ง findFilteredByUser ที่
  // หน้านี้ใช้ และ findRecentByUser ที่ undo-last ใช้) ไม่ต้องยิง Request เพิ่มเลย —
  // "โหลดเพิ่ม" ไม่กระทบข้อสรุปนี้ เพราะ transactions[0] คือแถวจาก offset=0 เสมอ
  // ไม่ว่าจะกด "โหลดเพิ่ม" ไปกี่ครั้งแล้วก็ตาม (Append ต่อท้าย ไม่ใช่แทนที่)
  const filterActive = hasActiveFilter({ symbolFilter, typeFilter, dateFrom, dateTo });

  async function handleAskUndo() {
    setError(null);

    if (!filterActive) {
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

        <label className="demo-field">
          <span>ประเภท</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            {TYPE_FILTER_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="demo-field">
          <span>จากวันที่</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>

        <label className="demo-field">
          <span>ถึงวันที่</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
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
            {filterActive
              ? 'ไม่พบรายการที่ตรงกับตัวกรองที่เลือก'
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

      {/* ── "โหลดเพิ่ม" (Pagination) — โผล่เฉพาะตอนยังมีรายการเหลือจริง (total มาจาก
          Exact Count ของ Backend ไม่ใช่เดาจากจำนวนที่ได้กลับมา) ───────────────── */}
      {!loading && !error && transactions.length > 0 && (
        <div className="demo-actions">
          <p className="app-note">
            แสดง {transactions.length} จาก {total} รายการ
          </p>
          {hasMore && (
            <button
              type="button"
              className="demo-btn"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default AppTransactions;
