import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { typeMeta } from '../../lib/assetTypeMeta.js';

ChartJS.register(ArcElement, Tooltip, Legend);

function fmt0(n) {
  const num = Number(n);
  return Number.isFinite(num) ? Math.round(num).toLocaleString('th-TH') : '0';
}

// ═══════════════════════════════════════════════════════════════════════
// AllocationCard — Donut สัดส่วนสินทรัพย์ตามประเภท (งานที่ 3)
// ═══════════════════════════════════════════════════════════════════════
// รับ allocation[] ตรงจาก overview.allocation (API.md §15.4) — แต่ละ Entry มี
// valueThbEquivalent ที่ Backend คำนวณไว้แล้วครบ (รวมสินทรัพย์ไม่มีราคาสด "ที่ต้นทุน"
// ตามที่ Backend Enrich มาให้ — ไม่ใช่การคำนวณเงินใหม่ที่นี่)
//
// "มูลค่ารวม" กลางวง = ผลรวมของ valueThbEquivalent ทุก Type (Sum ตัวเลขที่ Backend
// ให้มาแล้วเพื่อจุดประสงค์แสดงผลกลางวงเท่านั้น ไม่ใช่การคำนวณ P&L/ต้นทุนใหม่)
// ⚠️ ตัวเลขนี้ "ไม่เท่ากับ" การ์ด "มูลค่าพอร์ตรวม" ด้านบนเสมอไป เพราะการ์ดบนตัดสินทรัพย์
// ที่ยังไม่มีราคาตลาดออก (ดู portfolio.excludedCount) ส่วนวงนี้รวมสินทรัพย์นั้นไว้
// "ที่ต้นทุน" ด้วย — ทั้งสองค่าถูกต้องคนละความหมาย มี Footnote กำกับให้ชัดเจน
function AllocationCard({ allocation }) {
  const total = allocation.reduce((sum, a) => sum + a.valueThbEquivalent, 0);
  const hasUnpriced = allocation.some((a) => a.assets.some((x) => x.priceUnavailable));

  const chartData = {
    labels: allocation.map((a) => typeMeta(a.type).fullLabel),
    datasets: [
      {
        data: allocation.map((a) => a.valueThbEquivalent),
        backgroundColor: allocation.map((a) => typeMeta(a.type).color),
        borderWidth: 0,
        hoverOffset: 6,
      },
    ],
  };

  return (
    <div className="dh-card">
      <div className="dh-card-h">
        <h2>ภาพรวมการลงทุน</h2>
      </div>
      {allocation.length === 0 ? (
        <p className="dh-empty-msg">ยังไม่มีสินทรัพย์ในพอร์ต — บันทึก DCA แรกของคุณด้านบนเลย</p>
      ) : (
        <>
          <div className="dh-alloc-body">
            <div className="dh-donut-wrap">
              <Doughnut
                data={chartData}
                options={{ cutout: '68%', plugins: { legend: { display: false } } }}
              />
              <div className="dh-donut-center">
                <small>มูลค่ารวม</small>
                <b>฿{fmt0(total)}</b>
              </div>
            </div>
            <div className="dh-legend">
              {allocation.map((a) => (
                <div className="dh-lg-row" key={a.type}>
                  <span className="dh-lg-sw" style={{ background: typeMeta(a.type).color }} />
                  <span className="dh-lg-nm">{typeMeta(a.type).fullLabel}</span>
                  <span className="dh-lg-val">฿{fmt0(a.valueThbEquivalent)}</span>
                  <span className="dh-lg-pc">
                    {total > 0 ? ((a.valueThbEquivalent / total) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>
              ))}
            </div>
          </div>
          {hasUnpriced && (
            <p className="dh-chart-note">
              * บางสินทรัพย์ยังไม่มีราคาตลาดสด (เช่น หุ้นไทย) — แสดงมูลค่าที่ต้นทุนไปก่อน
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default AllocationCard;
