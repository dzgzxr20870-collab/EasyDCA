import { profitCacheKey } from './portfolioDetailData.js';

// ═══════════════════════════════════════════════════════════════════════════
// PortfolioHoldingsTable — ตารางสินทรัพย์ในพอร์ตหนึ่งใบ (Stage 9 เฟส 1)
// ═══════════════════════════════════════════════════════════════════════════
// คอลัมน์: Symbol · จำนวนที่ถือ · ต้นทุน · กำไร/ขาดทุน
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
                  <strong>{h.symbol}</strong>
                  {h.name && h.name !== h.symbol && <small> {h.name}</small>}
                </td>
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
