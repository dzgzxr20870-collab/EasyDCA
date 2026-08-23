import AssetAvatar from './AssetAvatar.jsx';
import { formatTransactionNote } from '../../lib/transactionNote.js';

const THAI_MONTH_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

// แปลง 'YYYY-MM-DD' (Presentation ล้วน — ไม่แตะตัวเลขเงินใดๆ) เป็น "17 ก.ค. 69"
function formatDateShort(dateStr) {
  const [y, m, d] = String(dateStr ?? '').split('-').map(Number);
  if (!y || !m || !d) return dateStr ?? '';
  return `${d} ${THAI_MONTH_SHORT[m - 1]} ${(y + 543) % 100}`;
}

function fmt(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-';
}

// ═══════════════════════════════════════════════════════════════════════
// RecentList — รายการล่าสุด 5 รายการ (งานที่ 3) — ตรงจาก overview.recent
// ═══════════════════════════════════════════════════════════════════════
// props:
//   recent: overview.recent (API.md §15.4) — {id,symbol,side,amountTotal,currency,
//     date,createdAt,note,source}
//   assetTypeBySymbol: Map<symbol,type> — ใช้แค่เลือกสี Avatar/Badge (Presentation)
//     สร้างจาก allocation[].assets ที่ Parent Flatten ไว้แล้ว ไม่ใช่ Field ใน recent[]
//     โดยตรง (recent ไม่มี type ติดมา)
//   onRequestUndo(txSummary): แสดงปุ่ม ↩︎ เฉพาะแถวบนสุด (รายการล่าสุดจริง — ตรงกับ
//     Semantics ของ POST /transactions/undo-last ที่ย้อนได้แค่ "รายการล่าสุด" เท่านั้น)
function RecentList({ recent, assetTypeBySymbol, onRequestUndo }) {
  if (recent.length === 0) {
    return (
      <div className="dh-card">
        <div className="dh-card-h">
          <h2>รายการล่าสุด</h2>
        </div>
        <p className="dh-empty-msg">ยังไม่มีรายการ</p>
      </div>
    );
  }

  return (
    <div className="dh-card">
      <div className="dh-card-h">
        <h2>รายการล่าสุด</h2>
      </div>
      <div className="dh-tx-list">
        {recent.map((tx, i) => {
          const noteText = formatTransactionNote(tx.note);
          return (
            <div className="dh-tx" key={tx.id}>
              <AssetAvatar symbol={tx.symbol} type={assetTypeBySymbol.get(tx.symbol)} />
              <span className="dh-tx-nm">
                <b>{tx.symbol}</b>{' '}
                <span className={`dh-side-b ${tx.side === 'buy' ? 'dh-b-buy' : 'dh-b-sell'}`}>
                  {tx.side === 'buy' ? 'ซื้อ' : 'ขาย'}
                </span>
                <small>
                  {formatDateShort(tx.date)}
                  {noteText ? ` · ${noteText}` : ''}
                </small>
              </span>
              {i === 0 && (
                <button
                  type="button"
                  className="dh-undo-btn"
                  // fix/misleading-messages ข้อ 2/4: ปุ่มนี้เปิด UndoConfirmModal ที่ใช้
                  // คำว่า "ย้อน" (รายการนี้บันทึกลง Ledger ไปแล้วจริง ไม่ใช่ Pending) —
                  // Label ต้องสอดคล้องกัน ไม่งั้นหน้าจอขัดกันเอง (ปุ่มเขียนอย่าง Modal
                  // เขียนอีกอย่าง) — คำสั่งที่พิมพ์ใน LINE ("ยกเลิกล่าสุด") ไม่แตะ เพราะ
                  // ผูกกับ commandParser Regex ตรงๆ (ไม่ใช่ข้อความอธิบายผล)
                  title="ย้อนรายการล่าสุด (เหมือนคำสั่ง 'ยกเลิกล่าสุด' ใน LINE)"
                  onClick={() =>
                    onRequestUndo({
                      type: tx.side,
                      symbol: tx.symbol,
                      amountTotal: tx.amountTotal,
                      currency: tx.currency,
                    })
                  }
                >
                  ↩︎ ย้อน
                </button>
              )}
              <span className="dh-tx-amt">
                <b>
                  {fmt(tx.amountTotal)} {tx.currency}
                </b>
                <small>เงินลงทุน</small>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RecentList;
