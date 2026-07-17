import { useEffect, useRef, useState } from 'react';
import { filterSymbols } from '../../lib/assetPickerSearch.js';
import { typeMeta, CATEGORIES } from '../../lib/assetTypeMeta.js';

// ═══════════════════════════════════════════════════════════════════════
// AssetPicker — Dropdown ค้นหา+เลื่อนเลือกสินทรัพย์ (S8 R1b งานที่ 2)
// ═══════════════════════════════════════════════════════════════════════
// Port ตรงจาก design/easydca-dashboard-redesign.html (#picker/#dd-*) — Keyboard
// Nav (ลูกศรขึ้น/ลง, Enter เลือก, Esc ปิด), Chips หมวด, Empty State ชี้ไป LINE
// ทั้งหมด Port ตรรกะเดิม ต่างแค่เป็น React Component + ข้อมูลจริงจาก Backend
// (ไม่ใช่ Array Hardcode ในมockup)
//
// props:
//   symbols: [{symbol,name,type}] จาก GET /api/v1/assets/symbols
//   value: { symbol, name, type } | null — สินทรัพย์ที่เลือกอยู่ปัจจุบัน
//   onChange(picked): เรียกเมื่อผู้ใช้เลือกสินทรัพย์ใหม่
function AssetPicker({ symbols, value, onChange, disabled = false, openSignal }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const rootRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);
  const mountedSignalRef = useRef(openSignal);

  const filtered = filterSymbols(symbols, { category, query });

  // ปิด Dropdown เมื่อคลิกนอกกล่อง (Pattern เดียวกับ Mockup: document click listener)
  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function openDropdown() {
    if (disabled) return;
    setQuery('');
    setCategory('all');
    setHighlight(0);
    setOpen(true);
    // รอ Render กล่อง Search เสร็จก่อนค่อย Focus (Pattern เดียวกับ Mockup setTimeout)
    setTimeout(() => searchInputRef.current?.focus(), 30);
  }

  function closeDropdown() {
    setOpen(false);
  }

  // เปิด Dropdown อัตโนมัติเมื่อถูกสั่งจากภายนอก (ปุ่มบันทึกกลาง Bottom Nav บนมือถือ —
  // "กดแล้ว scroll ไปฟอร์ม + เปิด dropdown เลือกสินทรัพย์ให้อัตโนมัติ" ตาม Requirement
  // งานที่ 1) — เพิ่มค่า openSignal (Counter) จาก Parent ทุกครั้งที่ต้องการสั่งเปิด
  // ข้ามค่าตอน Mount ครั้งแรก (ไม่เปิดเองตอนโหลดหน้า)
  useEffect(() => {
    if (openSignal === undefined || openSignal === mountedSignalRef.current) return;
    mountedSignalRef.current = openSignal;
    if (!value) openDropdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  function choose(item) {
    onChange(item);
    closeDropdown();
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) choose(filtered[highlight]);
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  }

  // Scroll รายการที่ Highlight ให้อยู่ในมุมมองเสมอ (Keyboard Nav ต้องเห็นตัวที่เลือก)
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  return (
    <div className={`dh-picker${open ? ' dh-picker-open' : ''}`} ref={rootRef}>
      <div
        className="dh-picker-input"
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeDropdown() : openDropdown())}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDropdown();
          }
        }}
      >
        {value ? (
          <>
            <span className="dh-avatar" style={{ background: typeMeta(value.type).color }}>
              {value.symbol.slice(0, 4)}
            </span>
            <span className="dh-picker-sym">
              <b>{value.symbol}</b>
              <small>{value.name}</small>
            </span>
          </>
        ) : (
          <>
            <span className="dh-avatar" style={{ background: '#CBD5C0' }}>
              ?
            </span>
            <span className="dh-picker-placeholder">เลือกสินทรัพย์…</span>
          </>
        )}
        <span className="dh-picker-caret">▼</span>
      </div>

      {open && (
        <div className="dh-dd">
          <div className="dh-dd-search">
            🔍
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="พิมพ์ชื่อหรือสัญลักษณ์ เช่น AMD, ปตท, บิตคอยน์"
            />
          </div>
          <div className="dh-dd-cats">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`dh-chip${category === c.key ? ' dh-chip-on' : ''}`}
                onClick={() => {
                  setCategory(c.key);
                  setHighlight(0);
                  searchInputRef.current?.focus();
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="dh-dd-list" ref={listRef} role="listbox">
            {filtered.length === 0 ? (
              <div className="dh-dd-empty">
                ไม่พบ "<b>{query}</b>" ในรายการ
                <br />
                <span style={{ fontSize: '12px' }}>
                  ลองสะกดแบบอื่น หรือแจ้งทีมงานผ่านแชท LINE เพื่อขอเพิ่มสินทรัพย์นี้
                </span>
              </div>
            ) : (
              filtered.slice(0, 400).map((s, i) => {
                const meta = typeMeta(s.type);
                return (
                  <div
                    key={s.symbol}
                    data-idx={i}
                    role="option"
                    aria-selected={i === highlight}
                    className={`dh-dd-item${i === highlight ? ' dh-dd-item-hi' : ''}`}
                    onClick={() => choose(s)}
                    onMouseMove={() => setHighlight(i)}
                  >
                    <span className="dh-avatar" style={{ background: meta.color }}>
                      {s.symbol.slice(0, 4)}
                    </span>
                    <span className="dh-dd-nm">
                      <b>{s.symbol}</b>
                      <small>{s.name}</small>
                    </span>
                    <span className={`dh-tbadge ${meta.badgeClass}`}>{meta.label}</span>
                  </div>
                );
              })
            )}
          </div>
          <div className="dh-dd-foot">
            ทั้งหมด <b>{filtered.length.toLocaleString('th-TH')}</b> รายการ · ไม่เจอที่ต้องการ?
            แจ้งเพิ่มได้ที่แชท LINE
          </div>
        </div>
      )}
    </div>
  );
}

export default AssetPicker;
