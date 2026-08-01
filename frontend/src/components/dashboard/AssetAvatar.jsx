import { useEffect, useState } from 'react';
import { typeMeta } from '../../lib/assetTypeMeta.js';
import { resolveStockLogoUrl, getCryptoLogoUrl } from '../../lib/assetLogo.js';

// ═══════════════════════════════════════════════════════════════════════
// AssetAvatar — โลโก้สินทรัพย์ (ดึงอัตโนมัติ) แทนตัวอักษรย่อ+สีเดิม
// ═══════════════════════════════════════════════════════════════════════
// รวม Logic ที่เคย Copy ซ้ำ 6 จุดทั่วหน้า Dashboard (AssetPicker ×3, DcaPlansSection,
// RecentList, SidePanels ×2) ไว้ที่เดียว — ทุกจุดเดิม Render
// `<span className="dh-avatar" style={{background: meta.color}}>{symbol.slice(0,4)}</span>`
// เหมือนกันเป๊ะ Component นี้ "เป็น" กล่องเดิมนั้น (className/ขนาดเท่าเดิม) แค่
// พยายามโชว์โลโก้จริงทับก่อน ถ้าหาไม่ได้/โหลดไม่สำเร็จค่อย Fallback กลับตัวอักษรย่อ
// (ไม่ใช่ Broken Image Icon — <img> จะไม่ถูก Render เลยเมื่อพลาด)
//
// กลยุทธ์ต่อ Type (รายละเอียดเต็มดู lib/assetLogo.js):
//   - stock_th/stock_us: URL จาก Domain Map แบบ Sync — Render <img> ทันทีถ้ามี
//     Domain ที่รู้จัก พร้อม onError สลับไปตัวอักษรย่อถ้าโหลดรูปไม่สำเร็จ (404/Network)
//   - crypto: ต้องยิง CoinGecko API หา URL ก่อน (Async) จึง Render ตัวอักษรย่อไปก่อน
//     เสมอในการ Render ครั้งแรก แล้วค่อยสลับเป็นรูปถ้า useEffect Resolve สำเร็จ
//   - gold_bar/gold_ornament/ไม่รู้จัก: ไม่มีโลโก้บริษัท → ตัวอักษรย่อเสมอ
//
// props:
//   symbol: string (บังคับ)
//   type: asset type จาก Backend ('crypto'|'stock_th'|'stock_us'|'gold_bar'|...)
function AssetAvatar({ symbol, type }) {
  const meta = typeMeta(type);
  const initial = String(symbol ?? '').slice(0, 4);

  // logoUrl: null = ยังไม่มีรูปให้โชว์ (ตัวอักษรย่อ) — stock ที่มี Domain รู้จัก
  // เริ่มด้วย URL ทันที (Sync) ส่วน crypto เริ่มด้วย null เสมอ (ต้องรอ Fetch)
  const [logoUrl, setLogoUrl] = useState(() => (type === 'crypto' ? null : resolveStockLogoUrl(symbol)));
  // failed: true เมื่อ <img> โหลดไม่สำเร็จ (404/Network) — ไม่ลองโหลดซ้ำ Symbol เดิม
  // อีกในการ Render รอบนี้ กัน Loop โหลดถี่ถ้า URL เสียจริง
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Reset ทุกครั้งที่ Symbol/Type เปลี่ยน (Component ถูก Reuse ข้าม Row เช่นใน List)
    setFailed(false);
    setLogoUrl(type === 'crypto' ? null : resolveStockLogoUrl(symbol));

    if (type !== 'crypto') return undefined;

    let cancelled = false;
    // localStorage จริงเฉพาะตอนรันในเบราว์เซอร์ (Component นี้ไม่ได้ถูก Render ฝั่ง
    // Server แบบ SSR จริงในโปรเจกต์นี้ — เช็คไว้กันพังถ้ามีการทดสอบผ่าน
    // renderToStaticMarkup ที่ไม่มี window เท่านั้น)
    const storage = typeof window !== 'undefined' ? window.localStorage : null;

    getCryptoLogoUrl(symbol, { storage }).then((url) => {
      if (!cancelled && url) setLogoUrl(url);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, type]);

  const showImage = Boolean(logoUrl) && !failed;

  return (
    <span className="dh-avatar" style={{ background: meta.color }}>
      {showImage ? (
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </span>
  );
}

export default AssetAvatar;
