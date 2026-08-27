import { useState, useEffect, useCallback } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { getAllocation } from '../../lib/portfolioApi.js';
import { portfolioWriteState, canCreatePortfolio } from '../../lib/entitlements.js';
import { ALL_PORTFOLIOS } from '../../components/app/AppShell.jsx';
import AllocationDonut from '../../components/app/AllocationDonut.jsx';
import CreatePortfolioModal from '../../components/app/CreatePortfolioModal.jsx';
import RecordTransactionModal from '../../components/app/RecordTransactionModal.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// AppPortfolio — หน้า "พอร์ต" ต่อกับ API จริง (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// Port มาจาก `pages/demo/DemoPortfolio.jsx` — ต่อกับ
// `GET /api/v1/portfolio/allocation` ของจริงแทน `mockPortfolioMath`
//
// ── ธงจาก Backend ที่ Demo ไม่มีเลย และ **ห้ามตกหล่น** ────────────────────
//   fxUnavailableForUsd  → **ห้ามรวมยอดข้ามสกุลเงิน** ต้องเตือน ไม่ใช่โชว์ยอดที่
//                          ขาดส่วน USD ไปเงียบๆ (API.md ระบุไว้ชัด)
//   fxStale              → เรตเก่า ต้องติดหมายเหตุ
//   priceUnavailableCount → กลุ่มนั้น "ตีมูลค่าที่ต้นทุน" ไม่ใช่ราคาตลาด
//   isEmpty              → ยังไม่มีสินทรัพย์ → Empty State ไม่ใช่กราฟว่างเปล่า
//
// ⚠️ ทุกตัวเลขบนหน้านี้มาจาก Backend ล้วน **ห้ามคำนวณสัดส่วน/ยอดรวมเองใน Frontend**
// (กฎยืนข้อ 1 — Single Source of Truth ต่อ 1 สูตรเงิน) ถ้าคำนวณเอง วันหนึ่งเลข
// บนกราฟโดนัทจะไม่ตรงกับการ์ดสรุปแล้วหาสาเหตุไม่เจอ

const GROUP_BY_OPTIONS = [
  { value: 'assetType', label: 'ประเภทสินทรัพย์' },
  { value: 'broker', label: 'โบรก/Exchange' },
  { value: 'sector', label: 'หมวดธุรกิจ' },
];

function formatThb(n) {
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n ?? 0));
}

function AppPortfolio() {
  const {
    portfolios,
    portfolioId,
    selectedPortfolio,
    entitlements,
    reload,
    loading: shellLoading,
  } = useOutletContext();

  // ── Modal สร้างพอร์ต เปิดผ่าน `?new=1` ────────────────────────────────────
  // ⚠️ ใช้ Query Param แทน State ภายในโดยเจตนา — ปุ่ม "＋ สร้างพอร์ตใหม่" อยู่บน
  // Topbar ของ AppShell ซึ่งเป็น **คนละ Component** กับหน้านี้ · ถ้าใช้ State
  // ภายในจะต้องยก State ขึ้นไปไว้ที่ Shell แล้วส่งลงมาผ่าน Context ซึ่งผูก Shell
  // เข้ากับรายละเอียดของหน้าลูกโดยไม่จำเป็น · Query Param ยังทำให้ผู้ใช้กด Back
  // ปิด Modal ได้ตามที่คาด และแชร์ลิงก์ตรงเข้าหน้าสร้างพอร์ตได้ด้วย
  const [searchParams, setSearchParams] = useSearchParams();
  const showCreate = searchParams.get('new') === '1';

  // Modal บันทึกรายการ — เก็บ "แท็บที่จะเปิดค้างไว้" ไม่ใช่แค่ boolean
  // (null = ปิดอยู่) เพื่อให้ปุ่มซื้อ/ขายเปิด Modal เดียวกันคนละแท็บได้
  const [recordType, setRecordType] = useState(null);

  const [groupBy, setGroupBy] = useState('assetType');
  const [allocation, setAllocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAllocation({
        groupBy,
        // 'all' ไม่ใช่ id จริง — ไม่ส่ง portfolioId ไปเลยเมื่อดูรวมทุกพอร์ต
        portfolioId: portfolioId === ALL_PORTFOLIOS ? undefined : portfolioId,
      });
      setAllocation(data);
    } catch (err) {
      setError(err?.message ?? 'โหลดสัดส่วนพอร์ตไม่สำเร็จ');
      setAllocation(null);
    } finally {
      setLoading(false);
    }
  }, [groupBy, portfolioId]);

  useEffect(() => {
    load();
  }, [load]);

  const write = portfolioWriteState(selectedPortfolio);
  const createGate = canCreatePortfolio(entitlements, portfolios?.length);

  function closeCreate() {
    // ลบเฉพาะ Key 'new' ทิ้ง ไม่ล้าง Query ทั้งชุด (เผื่อมี Param อื่นในอนาคต)
    // replace: true — ไม่อยากให้การเปิด/ปิด Modal ทับประวัติการนำทางจริงของผู้ใช้
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }

  return (
    <section className="demo-page">
      <header className="demo-page__head">
        <h1>สัดส่วนพอร์ต</h1>

        <label className="demo-field">
          <span>จัดกลุ่มตาม</span>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            {GROUP_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      {(loading || shellLoading) && (
        <div className="app-state app-state--loading" role="status">
          กำลังคำนวณสัดส่วนพอร์ต...
        </div>
      )}

      {error && !loading && (
        <div className="app-state app-state--error" role="alert">
          <strong>โหลดสัดส่วนพอร์ตไม่สำเร็จ</strong>
          <p>{error}</p>
          <button type="button" className="demo-btn" onClick={load}>
            ลองใหม่อีกครั้ง
          </button>
        </div>
      )}

      {/* ⚠️ Empty State ต้องแยกจาก Error ให้ชัด — "ยังไม่มีสินทรัพย์" กับ
          "โหลดไม่สำเร็จ" เป็นคนละเรื่อง ถ้ารวมกันผู้ใช้ใหม่จะคิดว่าระบบพัง */}
      {!loading && !error && allocation?.isEmpty && (
        <div className="app-state app-state--empty">
          <strong>ยังไม่มีสินทรัพย์ในพอร์ตนี้</strong>
          <p>เมื่อบันทึกรายการซื้อแล้ว สัดส่วนพอร์ตจะแสดงที่นี่</p>
        </div>
      )}

      {!loading && !error && allocation && !allocation.isEmpty && (
        <>
          {/* ── ⚠️ ห้ามรวมยอดข้ามสกุลเมื่อดึงเรตไม่ได้ ─────────────────────
              ต้องเตือนก่อนโชว์ยอดรวม ไม่ใช่แสดงยอดที่ขาดส่วน USD ไปเงียบๆ */}
          {allocation.fxUnavailableForUsd && (
            <div className="app-state app-state--warn" role="alert">
              <strong>ยอดรวมยังไม่รวมสินทรัพย์สกุล USD</strong>
              <p>
                ตอนนี้ดึงอัตราแลกเปลี่ยน USD→THB ไม่ได้ ระบบจึงไม่รวมยอดข้ามสกุลเงินให้
                — ตัวเลขด้านล่างเป็นเฉพาะส่วนที่เป็นบาท
              </p>
            </div>
          )}

          {allocation.fxStale && !allocation.fxUnavailableForUsd && (
            <p className="app-note">
              ⏱️ อัตราแลกเปลี่ยนที่ใช้เป็นข้อมูลของวันที่ {allocation.fxAsOf} (ไม่ใช่เรตล่าสุด)
            </p>
          )}

          <p className="demo-total">
            มูลค่ารวม <strong>{formatThb(allocation.totalValueThb)}</strong> บาท
          </p>

          {/* ⚠️ โดนัทวาดจาก groups + percent ที่ Backend คำนวณมาแล้ว **ห้ามคำนวณ
              สัดส่วนเองที่นี่** (กฎยืนข้อ 1) · ไม่มีข้อมูล/ราคาดึงไม่ได้ → ขึ้นข้อความ
              "ราคาไม่พร้อมใช้งาน" ไม่ใช่วงกลมว่างหรือเลข 0 ที่ดูเหมือนความจริง */}
          <AllocationDonut
            groups={allocation.groups}
            totalValueThb={allocation.totalValueThb}
          />

          <ul className="demo-alloc-list">
            {allocation.groups.map((g) => (
              <li key={g.key ?? '__unspecified'} className="demo-alloc-item">
                <span className="demo-alloc-item__label">{g.label}</span>
                <span className="demo-alloc-item__value">
                  {formatThb(g.valueThb)} บาท ({g.percent}%)
                </span>
                <span className="demo-alloc-item__meta">
                  {g.assetCount} สินทรัพย์
                  {/* ⚠️ ต้องบอกเมื่อตัวเลขไม่ใช่ราคาตลาด — ไม่งั้นผู้ใช้จะเข้าใจว่า
                      หุ้นไทยมีราคาสดทั้งที่ระบบตีที่ต้นทุนให้ */}
                  {g.priceUnavailableCount > 0 && (
                    <em> · {g.priceUnavailableCount} รายการคิดที่ราคาทุน (ยังไม่มีราคาตลาด)</em>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {/* ⭐ พอร์ตถูกล็อก → ต้องเห็นชัดว่า "เพิ่มไม่ได้ แต่ยังขาย/ย้ายออกได้"
              **ห้ามซ่อนปุ่มขายเด็ดขาด** ไม่งั้นผู้ใช้จะคิดว่าติดกับ แล้วไม่บันทึก
              การขายที่เกิดขึ้นจริง → ยอดในพอร์ตผิดถาวร */}
          <div className="demo-actions">
            <button
              type="button"
              className="demo-btn demo-btn--primary"
              disabled={!write.canAdd}
              onClick={() => setRecordType('buy')}
            >
              ＋ บันทึกรายการซื้อ
            </button>
            {/* ⭐ canReduce เป็น true เสมอ — ปุ่มนี้ต้องกดได้ทุกกรณี แม้พอร์ตถูกล็อก
                ถ้าปิดด้วย ผู้ใช้จะคิดว่าติดกับแล้วไม่บันทึกการขายที่เกิดขึ้นจริง
                → ยอดในพอร์ตผิดถาวร (มติ Founder 24 ส.ค. 2569) */}
            <button
              type="button"
              className="demo-btn"
              disabled={!write.canReduce}
              onClick={() => setRecordType('sell')}
            >
              บันทึกการขาย
            </button>
          </div>

          {write.isLocked && (
            <p className="app-note">
              พอร์ตนี้เพิ่มรายการใหม่ไม่ได้ แต่ปุ่ม “บันทึกการขาย” ยังใช้ได้ตามปกติ
            </p>
          )}
        </>
      )}

      {/* ── Modal สร้างพอร์ตใหม่ ────────────────────────────────────────────
          ⚠️ กันเปิดเมื่อไม่มีสิทธิ์ด้วย — ผู้ใช้พิมพ์ `?new=1` เข้ามาตรงๆ ได้
          (Frontend กันคือ UX · ด่านจริงคือ RPC create_portfolio_locked เสมอ) */}
      {showCreate && createGate.allowed && (
        <CreatePortfolioModal
          onClose={closeCreate}
          onCreated={async () => {
            closeCreate();
            // โหลดรายการพอร์ตใน Shell ใหม่ ไม่งั้น Switcher จะยังไม่เห็นพอร์ตที่เพิ่งสร้าง
            await reload?.();
          }}
        />
      )}

      {/* ไม่มีสิทธิ์แต่เข้ามาที่ `?new=1` → บอกเหตุผลตรงๆ ไม่ใช่เงียบหายไปเฉยๆ */}
      {showCreate && !createGate.allowed && (
        <div className="app-state app-state--warn" role="alert">
          <strong>สร้างพอร์ตใหม่ไม่ได้ในตอนนี้</strong>
          <p>
            {createGate.reason === 'cap'
              ? 'จำนวนพอร์ตถึงขีดจำกัดของระบบแล้ว กรุณาลบพอร์ตที่ไม่ได้ใช้ก่อน'
              : createGate.reason === 'limit'
                ? 'แพ็กเกจ Free ใช้ได้ 1 พอร์ต — อัปเกรดเป็น Premium เพื่อแยกหลายพอร์ตได้'
                : 'กำลังตรวจสอบสิทธิ์ กรุณารอสักครู่'}
          </p>
          <button type="button" className="demo-btn" onClick={closeCreate}>
            ปิด
          </button>
        </div>
      )}

      {recordType && (
        <RecordTransactionModal
          selectedPortfolio={selectedPortfolio}
          defaultType={recordType}
          onClose={() => setRecordType(null)}
          onSaved={async () => {
            setRecordType(null);
            // ยอด/สัดส่วนเปลี่ยนแล้ว — โหลดทั้งสัดส่วนหน้านี้และพอร์ตใน Shell ใหม่
            await Promise.all([load(), reload?.()]);
          }}
        />
      )}
    </section>
  );
}

export default AppPortfolio;
