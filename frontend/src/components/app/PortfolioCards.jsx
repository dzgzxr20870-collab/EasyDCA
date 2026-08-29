import { LOCKED_PORTFOLIO_NOTICE } from '../../lib/entitlements.js';

// ═══════════════════════════════════════════════════════════════════════════
// PortfolioCards — การ์ดพอร์ตบนหน้ารวม /app/portfolio (Stage 9 เฟส 1)
// ═══════════════════════════════════════════════════════════════════════════
// แสดงผลล้วน — ไม่ยิง API เอง ไม่คำนวณเงินเอง · ตัวเลขทุกตัวรับมาทาง Props
// จาก Backend ตามที่ได้มา (กฎยืนข้อ 1)
//
// ⚠️ **ต้องแสดงพอร์ตที่ถูกล็อกด้วย ห้ามซ่อน** — ผู้ใช้ที่เคยเป็น Premium แล้วสร้าง
// ไว้หลายพอร์ต ข้อมูลยังอยู่ครบทุกรายการ (กฎเหล็กข้อ 2: ห้ามลบข้อมูลผู้ใช้)
// ถ้าซ่อนพอร์ตส่วนเกินไป ผู้ใช้จะเข้าใจว่าข้อมูลหายไปแล้ว
//
// ⚠️ ข้อความของพอร์ตที่ถูกล็อก Reuse จาก LOCKED_PORTFOLIO_NOTICE ที่เดียว
// (lib/entitlements.js) **ห้ามเขียนข้อความใหม่** — ถ้าสองที่พูดไม่ตรงกันผู้ใช้จะ
// สับสนว่าตกลงทำอะไรได้บ้าง

function fmt0(n) {
  const num = Number(n);
  return Number.isFinite(num) ? Math.round(num).toLocaleString('th-TH') : null;
}

// การ์ดหนึ่งใบ — ทั้งใบเป็นปุ่ม (กดตรงไหนก็เข้าได้ ไม่ใช่ต้องเล็งลิงก์เล็กๆ)
function PortfolioCard({ portfolio, valueThb, assetCount, onOpen }) {
  const locked = portfolio.canWrite === false;
  const value = fmt0(valueThb);

  return (
    <button
      type="button"
      className={`app-pf-card${locked ? ' app-pf-card--locked' : ''}`}
      onClick={() => onOpen(portfolio.id)}
      aria-label={`เปิดดูรายละเอียดพอร์ต ${portfolio.name}`}
    >
      <span className="app-pf-card__head">
        <strong className="app-pf-card__name">
          {portfolio.isDefault ? '⭐ ' : '🗂️ '}
          {portfolio.name}
        </strong>
        {portfolio.isDefault && <span className="app-pf-card__flag">พอร์ตหลัก</span>}
      </span>

      {/* ⚠️ ยังโหลดมูลค่าไม่เสร็จ/ไม่ได้โหลด → ขีดกลาง ไม่ใช่เลข 0
          (0 บาท กับ "ยังไม่รู้" คนละความหมายกันสิ้นเชิง) */}
      <span className="app-pf-card__value">
        {value === null ? <em className="app-note">—</em> : <>{value} บาท</>}
      </span>

      <span className="app-pf-card__meta">
        {typeof assetCount === 'number' ? `${assetCount} สินทรัพย์` : ' '}
      </span>

      {locked && (
        <span className="app-pf-card__locked">
          🔒 {LOCKED_PORTFOLIO_NOTICE.title}
        </span>
      )}
    </button>
  );
}

function PortfolioCards({
  portfolios = [],
  valueByPortfolio = {},
  assetCountByPortfolio = {},
  onOpen,
  onCreate,
  createGate,
}) {
  return (
    <div className="app-pf-cards">
      {portfolios.map((p) => (
        <PortfolioCard
          key={p.id}
          portfolio={p}
          valueThb={valueByPortfolio[p.id]}
          assetCount={assetCountByPortfolio[p.id]}
          onOpen={onOpen}
        />
      ))}

      {/* ── ปุ่มสร้างพอร์ตใบสุดท้าย (มติ Founder: อยากให้อยู่ใกล้พอร์ต) ───────
          ⚠️ ปุ่มบน Topbar ของ AppShell **ยังอยู่เหมือนเดิม** ไม่ได้ย้ายมา —
          ผู้ใช้ที่อยู่หน้าอื่น (ธุรกรรม/DCA/โปรไฟล์) ยังต้องสร้างพอร์ตได้
          ทั้งสองปุ่มชี้ไป `?new=1` ตัวเดียวกัน จึงไม่มี Flow ซ้อนให้ดูแลสองชุด

          ⚠️ ไม่มีสิทธิ์ → ยัง Render ปุ่มแต่บอกเหตุผล ไม่ซ่อนหาย (ซ่อนไปเลย
          ผู้ใช้ Free จะไม่รู้ว่ามีฟีเจอร์นี้อยู่) */}
      <button
        type="button"
        className="app-pf-card app-pf-card--new"
        onClick={onCreate}
        title={
          createGate?.allowed
            ? 'สร้างพอร์ตใหม่'
            : createGate?.reason === 'cap'
              ? 'จำนวนพอร์ตถึงขีดจำกัดของระบบแล้ว (ลบพอร์ตที่ไม่ได้ใช้ก่อน)'
              : createGate?.reason === 'limit'
                ? 'แพ็กเกจ Free ใช้ได้ 1 พอร์ต — อัปเกรดเพื่อแยกหลายพอร์ต'
                : 'กำลังตรวจสอบสิทธิ์...'
        }
      >
        <span className="app-pf-card__plus">＋</span>
        <span>สร้างพอร์ตใหม่</span>
        {createGate && !createGate.allowed && createGate.reason !== 'unknown' && (
          <span className="app-pf-card__meta">
            {createGate.reason === 'cap' ? 'ถึงขีดจำกัดของระบบแล้ว' : 'ต้องใช้ Premium'}
          </span>
        )}
      </button>
    </div>
  );
}

export { PortfolioCard };
export default PortfolioCards;
