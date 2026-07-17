import { useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend, Filler);

const THAI_MONTH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

// 'YYYY-MM' → "ก.ค. 69" (เดือนย่อไทย + ปี พ.ศ. 2 หลัก) — Presentation ล้วน
function monthLabelShort(key) {
  const [yearStr, monthStr] = key.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const beYear = (year + 543) % 100;
  return `${THAI_MONTH_SHORT[month - 1]} ${String(beYear).padStart(2, '0')}`;
}

const RANGE_TABS = [
  { months: 3, label: '3 เดือน' },
  { months: 6, label: '6 เดือน' },
  { months: 12, label: '1 ปี' },
];

// ═══════════════════════════════════════════════════════════════════════
// InvestedChart — กราฟ "เงินลงทุนสะสม" รายเดือน (งานที่ 3)
// ═══════════════════════════════════════════════════════════════════════
// วาดตรงจาก overview.monthlyInvested[].cumulativeByCurrency (API.md §15.4) — Backend
// คืนครบ 12 เดือนต่อเนื่องเสมอ (คำนวณ cumulative มาให้แล้ว) Component นี้แค่ "ตัดหน้าต่าง
// ที่แสดง" (Slice Array ที่มีอยู่แล้ว ไม่ใช่คำนวณผลรวมใหม่) ตาม Tab 3/6/12 เดือนที่เลือก
//
// ⚠️ แยกเส้น THB/USD เสมอ (ห้ามพยายามรวมเป็นเส้นเดียว — ไม่มี Historical FX Rate
// ให้แปลงย้อนหลัง ดูเหตุผลเต็มใน API.md §15.4) — เส้น USD จะแสดงเฉพาะเมื่อมีข้อมูล
// USD จริง (เดือนใดเดือนหนึ่งมี cumulativeByCurrency.USD > 0) ไม่งั้นข้ามไปเพื่อไม่ให้
// กราฟรกด้วยเส้นแบนราบที่ 0 ตลอด
function InvestedChart({ monthlyInvested }) {
  const [rangeMonths, setRangeMonths] = useState(6);

  const windowed = monthlyInvested.slice(-rangeMonths);
  const hasUsd = monthlyInvested.some((m) => m.cumulativeByCurrency.USD > 0);

  const datasets = [
    {
      label: 'เงินลงทุนสะสม (THB)',
      data: windowed.map((m) => m.cumulativeByCurrency.THB),
      borderColor: '#1E9E55',
      backgroundColor: 'rgba(30,158,85,0.14)',
      fill: true,
      tension: 0.3,
      pointRadius: 3,
    },
  ];

  if (hasUsd) {
    datasets.push({
      label: 'เงินลงทุนสะสม (USD)',
      data: windowed.map((m) => m.cumulativeByCurrency.USD),
      borderColor: '#4A90D9',
      backgroundColor: 'rgba(74,144,217,0.10)',
      fill: true,
      tension: 0.3,
      pointRadius: 3,
      yAxisID: 'usd',
    });
  }

  const chartData = {
    labels: windowed.map((m) => monthLabelShort(m.month)),
    datasets,
  };

  const scales = { y: { beginAtZero: true } };
  if (hasUsd) {
    scales.usd = { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } };
  }

  return (
    <section className="dh-card">
      <div className="dh-card-h">
        <h2>เงินลงทุนสะสม</h2>
        <span className="dh-tag">คำนวณจากรายการจริงของคุณ</span>
        <div className="dh-sp" />
        <div className="dh-tabs">
          {RANGE_TABS.map((t) => (
            <button
              key={t.months}
              type="button"
              className={`dh-tab${rangeMonths === t.months ? ' dh-tab-on' : ''}`}
              onClick={() => setRangeMonths(t.months)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="dh-chart-wrap">
        {windowed.every((m) => m.count === 0) ? (
          <p className="dh-empty-msg">ยังไม่มีรายการในช่วงเวลานี้</p>
        ) : (
          <Line
            data={chartData}
            options={{
              responsive: true,
              plugins: { legend: { display: hasUsd, position: 'bottom' } },
              scales,
            }}
          />
        )}
      </div>
      <div className="dh-chart-note">
        * แสดง "เงินที่ลงไปสะสม" ไม่ใช่มูลค่าพอร์ตย้อนหลัง (ระบบไม่มีราคาสินทรัพย์ในอดีตมาคำนวณให้)
      </div>
    </section>
  );
}

export default InvestedChart;
