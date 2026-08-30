import { useState, useEffect, useCallback, useRef } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { getPortfolioHoldings, listBrokers } from '../../lib/portfolioApi.js';
import { portfolioWriteState, canCreatePortfolio } from '../../lib/entitlements.js';
import AllocationDonut from '../../components/app/AllocationDonut.jsx';
import CreatePortfolioModal from '../../components/app/CreatePortfolioModal.jsx';
import RecordTransactionModal from '../../components/app/RecordTransactionModal.jsx';
import PortfolioCards from '../../components/app/PortfolioCards.jsx';
import PortfolioHoldingsTable from '../../components/app/PortfolioHoldingsTable.jsx';
import MoveAssetPortfolioDialog from '../../components/app/MoveAssetPortfolioDialog.jsx';
import PortfolioSettingsPanel from '../../components/app/PortfolioSettingsPanel.jsx';
import {
  fetchAllocationCached,
  fetchProfitsForPortfolio,
  holdingsForPortfolio,
  assetCountByPortfolio,
  MAX_CARD_VALUE_FETCH,
} from '../../components/app/portfolioDetailData.js';

// ═══════════════════════════════════════════════════════════════════════════
// AppPortfolio — หน้า "พอร์ต" แบบ 2 ระดับ (Stage 9 เฟส 1 · Founder 29 ส.ค. 2569)
// ═══════════════════════════════════════════════════════════════════════════
//   ระดับ 1 (ไม่มี ?portfolio=) → โดนัทของทุกพอร์ตรวม + การ์ดพอร์ตให้กดเข้า
//   ระดับ 2 (?portfolio=<uuid>) → ตารางสินทรัพย์ + โดนัทของ **พอร์ตนั้นตัวเดียว**
//
// ⚠️ ใช้ Query Param แทน State ภายใน (Pattern เดียวกับ `?new=1` ที่มีอยู่เดิม) —
// กด Back ย้อนกลับหน้ารวมได้ตามที่คาด และแชร์ลิงก์ตรงเข้าพอร์ตหนึ่งได้
//
// ── ⚠️ กติกาเรื่องตัวเลข (กฎยืนข้อ 1 — Single Source of Truth) ──────────────
// **ห้ามคำนวณมูลค่า/กำไร/สัดส่วนเองในไฟล์นี้เด็ดขาด** ทุกตัวเลขมาจาก Backend:
//   มูลค่ารวมรายพอร์ต    ← /portfolio/allocation?portfolioId= → totalValueThb
//   จำนวนที่ถือ / ต้นทุน  ← /dashboard/portfolio → holdings[]
//   กำไร/ขาดทุน          ← /dashboard/profit/:symbol
// สิ่งเดียวที่ทำเองคือ **กรองแถวตาม holding.portfolioId ที่ Backend ประทับมาให้**
// และ **นับจำนวนแถว** ซึ่งไม่ใช่การคำนวณเงิน
//
// ── ❌ ไม่อยู่ในเฟสนี้: กราฟความเติบโตรายพอร์ตตามเวลา ─────────────────────
// `portfolio_snapshots` เก็บ 1 แถวต่อ (user, วัน) รวมทุกพอร์ตเป็นก้อนเดียว
// **ยังไม่มีคอลัมน์ portfolio_id** จึงแยกรายพอร์ตย้อนหลังไม่ได้เลย ต้องมี migration
// ใหม่ + Backfill ก่อน (เฟส 2) — ทางลัดเดียวที่พอมีคือเดาย้อนหลังจากธุรกรรม
// ซึ่งจะได้กราฟที่ผิดแบบเงียบๆ จึงห้ามทำ

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

// แถบเตือนเรื่องเรต/ราคา — ใช้ร่วมกันทั้งสองระดับ (Logic เดิมของหน้านี้ ไม่เขียนใหม่)
function AllocationNotices({ allocation }) {
  return (
    <>
      {/* ── ⚠️ ห้ามรวมยอดข้ามสกุลเมื่อดึงเรตไม่ได้ ─────────────────────────
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
    </>
  );
}

function AllocationBreakdown({ allocation }) {
  return (
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
  );
}

function AppPortfolio() {
  const {
    portfolios,
    selectedPortfolio,
    entitlements,
    reload,
    loading: shellLoading,
  } = useOutletContext();

  const [searchParams, setSearchParams] = useSearchParams();
  const showCreate = searchParams.get('new') === '1';
  // ระดับ 2 — id ของพอร์ตที่กำลังเปิดดู (null = อยู่หน้ารวม)
  const openedId = searchParams.get('portfolio');
  const opened = (portfolios ?? []).find((p) => p.id === openedId) ?? null;

  const [recordType, setRecordType] = useState(null);
  // สินทรัพย์ที่กำลังจะย้ายพอร์ต (null = ไม่ได้เปิด Dialog)
  const [movingHolding, setMovingHolding] = useState(null);
  // เมนู "ตั้งค่าพอร์ต" — เปิดได้เฉพาะระดับ 2 (มีพอร์ตเปิดอยู่) เท่านั้น
  const [showSettings, setShowSettings] = useState(false);
  const [groupBy, setGroupBy] = useState('assetType');

  // ── Cache ข้าม Render/ข้ามการสลับพอร์ต ─────────────────────────────────────
  // useRef ไม่ใช่ useState โดยเจตนา: การเติม Cache ไม่ควร Trigger Render เอง
  // (ค่าที่ได้ถูกยัดลง State ของหน้าอยู่แล้ว) · ผลลัพธ์คือกดเข้า-ออกพอร์ตเดิม
  // ไปมาไม่ยิง API ซ้ำเลย ซึ่งจำเป็นจริงเพราะ Rate Limiter 300 req/15 นาที
  const cacheRef = useRef(new Map());

  const [allocation, setAllocation] = useState(null);
  const [holdings, setHoldings] = useState([]);
  // ชื่อโบรกสำหรับตาราง Holdings ระดับ 2 (holding.brokerId ดิบไม่มีชื่อติดมา —
  // ต้อง Join เอง) โหลดแบบ Lazy เฉพาะตอนเปิดดูรายละเอียดพอร์ตครั้งแรก
  const [brokers, setBrokers] = useState([]);
  const [valueByPortfolio, setValueByPortfolio] = useState({});
  const [profitBySymbol, setProfitBySymbol] = useState({});
  const [profitCapped, setProfitCapped] = useState(false);
  const [loadingProfit, setLoadingProfit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const rows = holdingsForPortfolio(holdings, openedId);

  // ── โหลดข้อมูลของ "ระดับที่กำลังดูอยู่" ────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cache = cacheRef.current;

      // holdings ชุดเดียวใช้ได้กับทุกพอร์ต (แต่ละแถวมี portfolioId ติดมา) —
      // จำไว้ใน Cache เหมือนกันเพื่อไม่ยิงซ้ำทุกครั้งที่สลับพอร์ต
      let holdingList = cache.get('holdings');
      if (!holdingList) {
        const summary = await getPortfolioHoldings();
        holdingList = summary?.holdings ?? [];
        cache.set('holdings', holdingList);
      }
      setHoldings(holdingList);

      // โดนัท: หน้ารวม = ทุกพอร์ต (ไม่ส่ง portfolioId) · ระดับ 2 = พอร์ตนั้นตัวเดียว
      const alloc = await fetchAllocationCached(cache, { portfolioId: openedId, groupBy });
      setAllocation(alloc);

      if (openedId) {
        const detailRows = holdingsForPortfolio(holdingList, openedId);
        const { profitBySymbol: profits, capped } = await fetchProfitsForPortfolio(cache, {
          portfolioId: openedId,
          rows: detailRows,
        });
        setProfitBySymbol(profits);
        setProfitCapped(capped);

        // ── ชื่อโบรกสำหรับคอลัมน์ "โบรก/Exchange" ──────────────────────────
        // ⚠️ GET /dashboard/portfolio คืนแค่ brokerId ไม่มีชื่อ (ตรวจแล้วที่
        // portfolio.service) ต้องยิง GET /brokers แยก — จำไว้ใน Cache เดียวกัน
        // (คำขอเดียวจบตลอดอายุหน้า ไม่ยิงซ้ำตอนสลับพอร์ตไปมา)
        let brokerList = cache.get('brokers');
        if (!brokerList) {
          brokerList = await listBrokers();
          cache.set('brokers', brokerList);
        }
        setBrokers(brokerList);
      } else {
        // ── มูลค่ารายพอร์ตสำหรับการ์ด ────────────────────────────────────────
        // ⚠️ ต้องยิง allocation ทีละพอร์ต เพราะ groupBy รองรับแค่
        // broker/sector/assetType — **ไม่มี 'portfolio'** (ตรวจแล้วที่
        // allocation.service.GROUP_BY_OPTIONS) จึงไม่มีทางได้มูลค่ารายพอร์ต
        // ครบทุกใบในคำขอเดียว
        //
        // จำกัดจำนวนไว้กัน Rate Limit: Premium สร้างได้ถึง 50 พอร์ต (Sanity Cap)
        // ถ้ามีมากกว่าเพดาน การ์ดที่เหลือจะแสดง "จำนวนสินทรัพย์" อย่างเดียว
        // (มาจาก holdings คำขอเดียว) แล้วมูลค่าไปดูในระดับ 2 แทน — ดีกว่ายิง 50
        // คำขอทุกครั้งที่เปิดหน้า
        const list = (portfolios ?? []).slice(0, MAX_CARD_VALUE_FETCH);
        const entries = await Promise.all(
          list.map((p) =>
            fetchAllocationCached(cache, { portfolioId: p.id, groupBy: 'assetType' })
              .then((a) => [p.id, a?.totalValueThb])
              .catch(() => [p.id, undefined])
          )
        );
        setValueByPortfolio(Object.fromEntries(entries));
      }
    } catch (err) {
      setError(err?.message ?? 'โหลดข้อมูลพอร์ตไม่สำเร็จ');
      setAllocation(null);
    } finally {
      setLoading(false);
    }
  }, [groupBy, openedId, portfolios]);

  useEffect(() => {
    load();
  }, [load]);

  // ผู้ใช้กดโหลดกำไร/ขาดทุนเองเมื่อพอร์ตใหญ่เกินเพดาน
  async function handleLoadProfit() {
    setLoadingProfit(true);
    try {
      const { profitBySymbol: profits } = await fetchProfitsForPortfolio(cacheRef.current, {
        portfolioId: openedId,
        rows,
        force: true,
      });
      setProfitBySymbol(profits);
      setProfitCapped(false);
    } finally {
      setLoadingProfit(false);
    }
  }

  // ⚠️ ระดับ 2: สิทธิ์เขียนต้องดูจาก **พอร์ตที่เปิดอยู่** ไม่ใช่ Switcher ด้านบน
  const write = portfolioWriteState(opened ?? selectedPortfolio);
  const createGate = canCreatePortfolio(entitlements, portfolios?.length);

  function setParam(mutate) {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace: true });
  }

  const openPortfolio = (id) => setParam((n) => n.set('portfolio', id));
  const backToOverview = () => setParam((n) => n.delete('portfolio'));
  const openCreate = () => setParam((n) => n.set('new', '1'));
  const closeCreate = () => setParam((n) => n.delete('new'));

  const busy = loading || shellLoading;

  return (
    <section className="demo-page">
      <header className="demo-page__head">
        {opened ? (
          <>
            <button type="button" className="demo-btn" onClick={backToOverview}>
              ← พอร์ตทั้งหมด
            </button>
            <h1>
              {opened.isDefault ? '⭐ ' : '🗂️ '}
              {opened.name}
            </h1>
            {/* ⚠️ ต้องอยู่เฉพาะระดับ 2 (เปิดพอร์ตอยู่เท่านั้น) — ห้ามโผล่ที่หน้า
                การ์ดรวม /app/portfolio (มติ Founder 30 ส.ค. 2569) */}
            <button type="button" className="demo-btn" onClick={() => setShowSettings(true)}>
              ⚙️ ตั้งค่าพอร์ต
            </button>
          </>
        ) : (
          <h1>พอร์ตของฉัน</h1>
        )}

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

      {/* ⚠️ ผู้ใช้เปิดลิงก์ ?portfolio=<id> ที่ไม่ใช่ของตัวเอง/ถูกลบไปแล้วได้ —
          ต้องบอกตรงๆ ไม่ใช่แสดงหน้ารวมเงียบๆ ให้เข้าใจว่าพอร์ตยังอยู่ */}
      {openedId && !opened && !shellLoading && (
        <div className="app-state app-state--empty">
          <strong>ไม่พบพอร์ตนี้</strong>
          <p>พอร์ตอาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง</p>
          <button type="button" className="demo-btn" onClick={backToOverview}>
            กลับไปหน้าพอร์ตทั้งหมด
          </button>
        </div>
      )}

      {busy && (
        <div className="app-state app-state--loading" role="status">
          กำลังโหลดข้อมูลพอร์ต...
        </div>
      )}

      {error && !loading && (
        <div className="app-state app-state--error" role="alert">
          <strong>โหลดข้อมูลพอร์ตไม่สำเร็จ</strong>
          <p>{error}</p>
          <button type="button" className="demo-btn" onClick={load}>
            ลองใหม่อีกครั้ง
          </button>
        </div>
      )}

      {!busy && !error && allocation && (
        <>
          <AllocationNotices allocation={allocation} />

          {/* ⚠️ Empty State ต้องแยกจาก Error ให้ชัด — "ยังไม่มีสินทรัพย์" กับ
              "โหลดไม่สำเร็จ" เป็นคนละเรื่อง ถ้ารวมกันผู้ใช้ใหม่จะคิดว่าระบบพัง */}
          {allocation.isEmpty ? (
            <div className="app-state app-state--empty">
              <strong>{opened ? 'ยังไม่มีสินทรัพย์ในพอร์ตนี้' : 'ยังไม่มีสินทรัพย์'}</strong>
              <p>เมื่อบันทึกรายการซื้อแล้ว สัดส่วนพอร์ตจะแสดงที่นี่</p>
            </div>
          ) : (
            <>
              <p className="demo-total">
                มูลค่ารวม <strong>{formatThb(allocation.totalValueThb)}</strong> บาท
              </p>

              {/* ⚠️ โดนัทวาดจาก groups + percent ที่ Backend คำนวณมาแล้ว
                  **ห้ามคำนวณสัดส่วนเองที่นี่** (กฎยืนข้อ 1) */}
              <AllocationDonut
                groups={allocation.groups}
                totalValueThb={allocation.totalValueThb}
              />

              <AllocationBreakdown allocation={allocation} />
            </>
          )}
        </>
      )}

      {/* ═══ ระดับ 2 — ตารางสินทรัพย์ในพอร์ตนี้ ═══════════════════════════ */}
      {!busy && !error && opened && (
        <>
          <h2 className="app-section-title">สินทรัพย์ในพอร์ตนี้</h2>
          <PortfolioHoldingsTable
            rows={rows}
            portfolioId={openedId}
            brokers={brokers}
            profitBySymbol={profitBySymbol}
            profitCapped={profitCapped}
            loadingProfit={loadingProfit}
            onLoadProfit={handleLoadProfit}
          />

          {/* ⭐ พอร์ตถูกล็อก → เพิ่มไม่ได้ แต่ **ห้ามซ่อนปุ่มขายเด็ดขาด**
              ไม่งั้นผู้ใช้จะคิดว่าติดกับ แล้วไม่บันทึกการขายที่เกิดขึ้นจริง
              → ยอดในพอร์ตผิดถาวร (มติ Founder 24 ส.ค. 2569) */}
          <div className="demo-actions">
            <button
              type="button"
              className="demo-btn demo-btn--primary"
              disabled={!write.canAdd}
              onClick={() => setRecordType('buy')}
            >
              ＋ บันทึกรายการซื้อ
            </button>
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

      {/* ═══ ระดับ 1 — การ์ดพอร์ต ═════════════════════════════════════════ */}
      {!busy && !openedId && (
        <>
          <h2 className="app-section-title">พอร์ตทั้งหมด</h2>
          <PortfolioCards
            portfolios={portfolios ?? []}
            valueByPortfolio={valueByPortfolio}
            assetCountByPortfolio={assetCountByPortfolio(holdings)}
            onOpen={openPortfolio}
            onCreate={openCreate}
            createGate={createGate}
          />
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
            // พอร์ตใหม่เพิ่งเกิด → Cache เดิมไม่มีมัน ต้องล้างก่อนโหลดใหม่
            cacheRef.current.clear();
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

      {showSettings && opened && (
        <PortfolioSettingsPanel
          portfolio={opened}
          holdings={rows}
          brokers={brokers}
          onClose={() => setShowSettings(false)}
          onRenamed={async () => {
            // ชื่อพอร์ตอยู่ใน outletContext.portfolios (ของ AppShell) ไม่ใช่ Cache
            // ของหน้านี้ — reload() พอ ไม่ต้องล้าง cacheRef (ตัวเลข/holdings ไม่เปลี่ยน)
            setShowSettings(false);
            await reload?.();
          }}
          onMoveAsset={(holding) => {
            // ปิด Settings แล้วเปิด Flow เดิมของ MoveAssetPortfolioDialog ต่อทันที
            setShowSettings(false);
            setMovingHolding(holding);
          }}
          onDeleted={async () => {
            // พอร์ตหายไปแล้ว + สินทรัพย์ (ถ้ามี) ย้ายเข้าพอร์ตหลัก — ล้าง Cache
            // ทั้งชุดเหมือน onMoved ด้านล่าง แล้วกลับไปหน้าการ์ดรวม
            setShowSettings(false);
            cacheRef.current.clear();
            backToOverview();
            await reload?.();
          }}
        />
      )}

      {movingHolding && (
        <MoveAssetPortfolioDialog
          holding={movingHolding}
          portfolios={portfolios ?? []}
          currentPortfolioId={openedId}
          onClose={() => setMovingHolding(null)}
          onMoved={async () => {
            // สินทรัพย์เปลี่ยนพอร์ตแล้ว — ยอด/สัดส่วนของ **ทั้งสองพอร์ต** เปลี่ยน
            // จึงล้าง Cache ทั้งชุด ไม่ใช่แค่พอร์ตที่เปิดอยู่
            cacheRef.current.clear();
            await Promise.all([load(), reload?.()]);
          }}
        />
      )}

      {recordType && (
        <RecordTransactionModal
          selectedPortfolio={opened ?? selectedPortfolio}
          portfolios={portfolios}
          defaultType={recordType}
          onClose={() => setRecordType(null)}
          onSaved={async () => {
            setRecordType(null);
            // ยอด/สัดส่วน/กำไรเปลี่ยนแล้ว — ล้าง Cache ทั้งชุดแล้วโหลดใหม่
            // (ไม่ล้างเฉพาะพอร์ตเดียว เพราะสินทรัพย์อาจไปรวมที่พอร์ตอื่นได้
            //  เมื่อ Symbol นั้นถืออยู่ที่อื่นแล้ว — ดู validateBuy)
            cacheRef.current.clear();
            await Promise.all([load(), reload?.()]);
          }}
        />
      )}
    </section>
  );
}

export default AppPortfolio;
