import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

// ═══════════════════════════════════════════════════════════════════════════
// AllocationDonut — โดนัทสัดส่วนพอร์ต จาก GET /portfolio/allocation (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ **ไม่ใช่ AllocationCard ตัวเดิม** และ **ห้ามพยายามใช้ตัวเดิมแทน** — Shape ของ
// สอง Endpoint ต่างกันคนละเรื่อง:
//   AllocationCard  ← overview.allocation[]      { type, valueThbEquivalent, assets[] }
//   ตัวนี้           ← allocation.groups[]        { key, label, valueThb, percent, ... }
// และ `/portfolio/allocation` จัดกลุ่มได้ 3 แบบ (assetType / broker / sector) ซึ่ง
// AllocationCard ผูกกับ `typeMeta()` ของประเภทสินทรัพย์อย่างเดียว จึงใช้แทนกันไม่ได้
//
// ⚠️⚠️ **percent มาจาก Backend ล้วน ห้ามคำนวณเองที่นี่** (กฎยืนข้อ 1) — ถ้าคำนวณเอง
// วันหนึ่งเลขบนโดนัทจะไม่ตรงกับรายการข้างล่างแล้วหาสาเหตุไม่เจอ · Component นี้ทำแค่
// "แปลงตัวเลขที่ได้มาแล้วเป็นรูปวาด" ไม่มีสูตรเงินอยู่ในไฟล์นี้เลยแม้แต่บรรทัดเดียว
//
// ⚠️ กราฟต้องไม่พังและ **ต้องไม่โชว์ตัวเลขมั่ว** เมื่อไม่มีข้อมูล/ราคาดึงไม่ได้:
//   - ไม่มีกลุ่มเลย / ทุกกลุ่มมูลค่า 0 → ข้อความแทนวงกลม ไม่ใช่วงว่างที่ดูเหมือนพัง
//   - มีรายการที่ยังไม่มีราคาตลาด → Footnote บอกว่า "ตีที่ราคาทุน" ไม่ใช่ปล่อยให้
//     ผู้ใช้เข้าใจว่าเป็นราคาสดทั้งวง

// จานสีคงที่ตามลำดับกลุ่ม — Backend เรียงกลุ่มเสถียร (มูลค่ามาก→น้อย) สีจึงไม่
// สลับไปมาระหว่างการโหลดแต่ละครั้ง · เลือกโทนที่แยกออกจากกันได้ในภาวะตาบอดสี
const PALETTE = [
  '#1E9E55',
  '#4A90D9',
  '#E8A33D',
  '#B565C7',
  '#E2686B',
  '#3FB6B0',
  '#8C8F94',
  '#7A6BD6',
];

function fmt0(n) {
  const num = Number(n);
  return Number.isFinite(num) ? Math.round(num).toLocaleString('th-TH') : '0';
}

function AllocationDonut({ groups, totalValueThb }) {
  const list = Array.isArray(groups) ? groups : [];
  // ⚠️ เช็ค "ทุกกลุ่มเป็น 0" ด้วย ไม่ใช่แค่ length — พอร์ตที่ถือของแต่ดึงราคาไม่ได้
  // เลยสักตัวจะได้ groups มาครบแต่มูลค่าเป็น 0 หมด ซึ่งวาดโดนัทออกมาเป็นวงว่าง
  const hasValue = list.some((g) => Number(g.valueThb) > 0);
  const unpricedTotal = list.reduce((n, g) => n + (Number(g.priceUnavailableCount) || 0), 0);

  if (!hasValue) {
    return (
      <div className="app-donut app-donut--empty">
        <p className="app-note">
          {list.length === 0
            ? 'ยังไม่มีข้อมูลสำหรับวาดกราฟสัดส่วน'
            : 'ราคาไม่พร้อมใช้งาน — ยังคำนวณสัดส่วนของพอร์ตนี้ไม่ได้ในตอนนี้'}
        </p>
      </div>
    );
  }

  const chartData = {
    labels: list.map((g) => g.label),
    datasets: [
      {
        data: list.map((g) => Number(g.valueThb) || 0),
        backgroundColor: list.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 0,
        hoverOffset: 6,
      },
    ],
  };

  return (
    <div className="app-donut">
      <div className="app-donut__chart">
        <Doughnut
          data={chartData}
          options={{
            cutout: '68%',
            plugins: { legend: { display: false } },
          }}
        />
        <div className="app-donut__center">
          <small>มูลค่ารวม</small>
          <strong>{fmt0(totalValueThb)}</strong>
          <small>บาท</small>
        </div>
      </div>

      {/* Legend เขียนเองแทนของ Chart.js — ต้องแสดง % ที่ Backend ส่งมาตรงๆ
          (Legend ในตัวของ Chart.js คำนวณ % เองจาก data ซึ่งอาจไม่ตรงกับ Backend
          เมื่อมีการปัดเศษ = เลขสองที่ไม่ตรงกันบนหน้าจอเดียวกัน) */}
      <ul className="app-donut__legend">
        {list.map((g, i) => (
          <li key={g.key ?? `__group_${i}`}>
            <span
              className="app-donut__swatch"
              style={{ background: PALETTE[i % PALETTE.length] }}
              aria-hidden="true"
            />
            <span className="app-donut__legend-label">{g.label}</span>
            <span className="app-donut__legend-value">{g.percent}%</span>
          </li>
        ))}
      </ul>

      {unpricedTotal > 0 && (
        <p className="app-note">
          ℹ️ มี {unpricedTotal} รายการที่ยังไม่มีราคาตลาด ระบบตีมูลค่าไว้ที่ราคาทุน
        </p>
      )}
    </div>
  );
}

export default AllocationDonut;
