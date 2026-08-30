import { profitCacheKey } from './portfolioDetailData.js';
// ⭐ เชื่อมโลโก้สินทรัพย์เข้าหน้าใหม่ (30 ส.ค. 2569) — Component เดิมที่ใช้อยู่ใน
// หน้าเก่า (DashboardHome ฯลฯ) ทำงานถูกต้องอยู่แล้ว งานนี้แค่ "เชื่อม" ไม่ใช่สร้างใหม่
// (ห้าม Copy Logic ไปสร้างไฟล์ซ้ำ) — holding.type มากับ /dashboard/portfolio อยู่แล้ว
// (portfolio.service.getPortfolioSummary → holdings.push({ type: asset.type })) จึง
// ไม่ต้อง Map/ยิง API เพิ่ม
import AssetAvatar from '../dashboard/AssetAvatar.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// PortfolioHoldingsTable — ตารางสินทรัพย์ในพอร์ตหนึ่งใบ (Stage 9 เฟส 1)
// ═══════════════════════════════════════════════════════════════════════════
// คอลัมน์: Symbol · โบรก/Exchange · จำนวนที่ถือ · ต้นทุน · กำไร/ขาดทุน
//
// ⚠️⚠️ **ห้ามคำนวณเงินในไฟล์นี้แม้แต่บรรทัดเดียว** (กฎยืนข้อ 1) — ทุกตัวเลขมาจาก
// Backend ตรงๆ:
//   heldQuantity / totalInvested / currency ← GET /dashboard/portfolio (holdings[])
//   profitLoss / profitLossPercent          ← GET /dashboard/profit/:symbol
// ไฟล์นี้ทำแค่จัดรูปแบบตัวเลขให้อ่านง่าย (toLocaleString) ไม่มีการบวก/ลบ/หารใดๆ
//
// ⚠️ **ห้ามรวมยอดข้ามสกุลเงินเอง** — แต่ละแถวแสดงสกุลของตัวเอง (THB/USD) ตามที่
// Backend ระบุมาใน holding.currency · ยอดรวมของพอร์ตใช้ allocation.totalValueThb
// ซึ่ง Backend แปลงและตรวจ fxUnavailableForUsd ให้แล้ว
//
// ── ⭐ คอลัมน์ "โบรก/Exchange" (Founder 30 ส.ค. 2569) ────────────────────────
// เหตุผล: EOSE ที่ดูเหมือนถือซ้ำ 2 แถว (106 USD จากสลิป, 600 USD จากกรอกเอง)
// ในพอร์ตเดียวกัน แท้จริงคือคนละโบรก (migration 046 — ถือ Symbol เดียวกันได้
// หลายโบรก) ซึ่งเป็นพฤติกรรมที่ถูกต้อง แต่ตารางไม่เคยบอกว่าแถวไหนเป็นของโบรก
// ไหน ทำให้ดูเหมือนข้อมูลซ้ำ/ผิดพลาด
//
// ⚠️ GET /dashboard/portfolio คืนแค่ `brokerId` **ไม่มีชื่อโบรก** (ตรวจแล้วที่
// portfolio.service.getPortfolioSummary — holding.brokerId ดิบ ไม่ join ชื่อ)
// ต้อง Join กับ `brokers` (มาจาก GET /brokers ที่ AppPortfolio.jsx โหลดมาให้ทาง
// Prop) เอง — brokerId: null = "ไม่ระบุ" (ผู้ใช้ไม่เลือกโบรกตอนบันทึก ไม่ใช่ Error)
// ⚠️ Fallback 'ไม่ระบุ' เมื่อหาไม่เจอในลิสต์ (บรรทัดสุดท้าย) เกิดได้ทางทฤษฎีเท่านั้น
// ถ้า `brokers` ยังโหลดไม่เสร็จตอน Render — ปกติจะไม่เกิดเพราะ AppPortfolio.jsx
// โหลด brokers ในกระบวนการ load() เดียวกับ holdings ก่อน Render ตารางนี้เสมอ ·
// broker ที่ถูกลบจริงจะทำให้ brokerId เป็น null จาก FK ON DELETE SET NULL อยู่แล้ว
// (broker.service.deleteBroker) จึงไม่มีทาง "มี brokerId แต่หาไม่เจอ" ค้างอยู่จริง
function brokerLabel(brokerId, brokers) {
  if (!brokerId) return 'ไม่ระบุ';
  return (brokers ?? []).find((b) => b?.id === brokerId)?.name ?? 'ไม่ระบุ';
}

function fmtQty(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  // ทศนิยมสูงสุด 8 ตำแหน่ง (คริปโต) แต่ไม่โชว์ศูนย์ท้ายที่ไม่มีความหมาย
  return num.toLocaleString('th-TH', { maximumFractionDigits: 8 });
}

function fmtMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// กำไร/ขาดทุนของแถวหนึ่ง — null = ยังไม่รู้ (ราคาไม่พร้อม / ยังไม่ได้โหลด)
// ⚠️ ต้องแยก "ยังไม่รู้" ออกจาก "เท่าทุน (0)" ให้ชัด ห้ามแสดง 0 แทนค่าที่ไม่รู้
function ProfitCell({ profit }) {
  if (!profit || !Number.isFinite(Number(profit.profitLoss))) {
    return <span className="app-note">—</span>;
  }

  const value = Number(profit.profitLoss);
  const percent = Number(profit.profitLossPercent);
  const tone = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const sign = value > 0 ? '+' : '';

  return (
    <span className={`app-pnl app-pnl--${tone}`}>
      {sign}
      {fmtMoney(value)}
      {Number.isFinite(percent) && (
        <small>
          {' '}
          ({sign}
          {percent.toFixed(2)}%)
        </small>
      )}
    </span>
  );
}

function PortfolioHoldingsTable({
  rows = [],
  portfolioId,
  brokers = [],
  profitBySymbol = {},
  profitCapped = false,
  onLoadProfit,
  loadingProfit = false,
}) {
  if (rows.length === 0) {
    return (
      <div className="app-state app-state--empty">
        <strong>ยังไม่มีสินทรัพย์ในพอร์ตนี้</strong>
        <p>เมื่อบันทึกรายการซื้อเข้าพอร์ตนี้แล้ว รายการจะแสดงที่นี่</p>
      </div>
    );
  }

  return (
    <>
      {/* ⚠️ เกินเพดานคำขอ → บอกตรงๆ ว่าทำไมคอลัมน์กำไรยังว่าง พร้อมทางออก
          ไม่ใช่ปล่อยให้ผู้ใช้เห็นขีดกลางทั้งคอลัมน์แล้วเดาเอาเองว่าระบบพัง */}
      {profitCapped && (
        <p className="app-state app-state--warn">
          พอร์ตนี้มีสินทรัพย์จำนวนมาก ระบบจึงยังไม่ดึงกำไร/ขาดทุนให้อัตโนมัติ (ต้องเรียกข้อมูลราคาทีละรายการ)
          — จำนวนที่ถือและต้นทุนด้านล่างแสดงครบตามปกติ{' '}
          <button type="button" className="demo-btn" onClick={onLoadProfit} disabled={loadingProfit}>
            {loadingProfit ? 'กำลังโหลด...' : 'โหลดกำไร/ขาดทุน'}
          </button>
        </p>
      )}

      {/* ตารางกว้างเกินจอมือถือได้ → ให้เลื่อนในกล่องตัวเอง ไม่ดันทั้งหน้าให้เลื่อนแนวนอน */}
      <div className="app-table-scroll">
        <table className="app-table">
          <thead>
            <tr>
              <th>สินทรัพย์</th>
              {/* ⭐ จอแคบ (≤620px) ซ่อนคอลัมน์นี้แล้วโชว์เป็นบรรทัดรองใต้ชื่อ
                  สินทรัพย์แทน (.app-table__broker-inline ใน td แรก) — CSS ล้วน
                  ไม่ต้องตรวจความกว้างจอด้วย JS (ดู appShell.css) */}
              <th className="app-table__broker">โบรก/Exchange</th>
              <th className="app-table__num">จำนวนที่ถือ</th>
              <th className="app-table__num">ต้นทุน</th>
              <th className="app-table__num">กำไร/ขาดทุน</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              // ⚠️ key ต้องมี brokerId ด้วย — Symbol เดียวกันต่างโบรกคือคนละแถว
              // (migration 046) ถ้าใช้ symbol อย่างเดียว React จะรวมสองแถวเป็นใบเดียว
              <tr key={`${h.symbol}|${h.brokerId ?? 'none'}`}>
                <td>
                  {/* ⭐ h.type มากับ holding ตรงๆ อยู่แล้ว (ดู Comment หัวไฟล์)
                      — ไม่ต้องสร้าง assetTypeBySymbol Map เหมือนหน้าที่ไม่มี type ติดมา */}
                  <span className="app-table__asset">
                    <AssetAvatar symbol={h.symbol} type={h.type} />
                    <span className="app-table__asset-text">
                      <strong>{h.symbol}</strong>
                      {h.name && h.name !== h.symbol && <small> {h.name}</small>}
                      {/* ⭐ จอแคบเท่านั้น — คู่กับคอลัมน์ .app-table__broker ที่ซ่อน
                          อยู่ (สลับกันด้วย CSS ไม่ใช่ JS) กันข้อมูลหายไปทั้งสองทาง */}
                      <small className="app-table__broker-inline">
                        🏦 {brokerLabel(h.brokerId, brokers)}
                      </small>
                    </span>
                  </span>
                </td>
                <td className="app-table__broker">{brokerLabel(h.brokerId, brokers)}</td>
                <td className="app-table__num">{fmtQty(h.heldQuantity)}</td>
                <td className="app-table__num">
                  {fmtMoney(h.totalInvested)}{' '}
                  <small>{h.currency === 'USD' ? 'USD' : 'บาท'}</small>
                </td>
                <td className="app-table__num">
                  <ProfitCell profit={profitBySymbol[profitCacheKey(portfolioId, h.symbol, h.brokerId)]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default PortfolioHoldingsTable;
