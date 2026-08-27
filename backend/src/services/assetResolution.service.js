const assetRepository = require('../repositories/asset.repository');

// ═══════════════════════════════════════════════════════════════════════════
// assetResolution.service — "Symbol นี้หมายถึงสินทรัพย์แถวไหน" ตัดสินที่นี่ที่เดียว
// ═══════════════════════════════════════════════════════════════════════════
// Stage 5 (migration 046) เปิดให้ถือ Symbol เดียวกันได้หลายโบรก:
//   UNIQUE NULLS NOT DISTINCT (user_id, symbol, portfolio_id, broker_id)
// แปลว่า "BTC" ของผู้ใช้คนหนึ่งอาจตรงกับ assets ได้ **มากกว่า 1 แถว**
//
// ── ทำไมต้องเป็นไฟล์เดียวกลาง ไม่ใช่เขียนซ้ำในแต่ละ Service ────────────────────
// จุดที่ต้องแปลง Symbol → asset row มีอยู่ 4 เส้นทางบนเส้นทางเงิน:
//   transaction.validateBuy · transaction.validateSell · profit.getAssetProfit ·
//   bulkImport.checkAggregateAssetLimit  (+ webhook ที่ Resolve กองทุน)
// ถ้าแต่ละที่ตัดสินเองด้วยกฎที่ต่างกันแม้นิดเดียว จะได้ระบบที่ "ซื้อเข้าโบรก A
// แต่คำนวณกำไรจากโบรก B" โดยไม่มี Error ใดๆ ให้เห็น — กฎยืนข้อ 1 (Single Source
// of Truth ต่อ 1 สูตรเงิน) จึงบังคับให้รวมมาที่ไฟล์นี้
//
// ── กฎเหล็กของไฟล์นี้: ห้ามเดาแทนผู้ใช้เด็ดขาด ────────────────────────────────
// เมื่อกำกวม (Symbol ตรงหลายแถว และ Caller ไม่ได้ระบุโบรกมา) ต้อง **throw**
// ไม่ใช่หยิบแถวแรก/แถวที่ถือเยอะที่สุด/แถวที่ใหม่ที่สุด — เพราะการเดาผิดหมายถึง
// ธุรกรรมถูกบันทึกเข้าโบรกผิด ทำให้ต้นทุนเฉลี่ยของสินทรัพย์ **สองก้อนพร้อมกัน**
// เพี้ยน และไม่มีใครรู้ตัวจนกว่าจะดูตัวเลขกำไรแล้วเอะใจ
// (กฎยืนข้อ 11: "Silent Default เป็น Anti-pattern เสมอ — พาร์สข้อมูลไม่ชัดเจน
// ต้องถามผู้ใช้หรือ Reject ไม่ใช่เดาค่า Default" · Founder ยืนยัน 23 ส.ค. 2569
// ว่ายอมให้ผู้ใช้กดปุ่มเพิ่ม 1 ครั้ง ดีกว่าปล่อยให้ต้นทุนเฉลี่ยเพี้ยน)
//
// ── กติกาของ Argument (อ่านก่อนแก้โค้ดที่เรียกไฟล์นี้) ──────────────────────
// ⚠️⚠️ **ใช้กับ `brokerId` และ `portfolioId` เหมือนกันทั้งคู่** ⚠️⚠️
//   undefined = "ผู้ใช้ยังไม่ได้ระบุ"        → ไม่กรองมิตินั้นเลย · กำกวมเมื่อไหร่ throw
//   null      = "ระบุแล้วว่า *ไม่มี*"        → เจาะจงแถวที่คอลัมน์นั้น IS NULL
//   '<uuid>'  = เจาะจงค่านั้น
//
// ⚠️ **ห้ามเขียน `?? null` ให้ทั้งสองตัวที่จุดใดก็ตามก่อนส่งเข้ามา** —
// การทำแบบนั้นเปลี่ยน "ยังไม่ได้ถาม" ให้กลายเป็น "ตอบแล้วว่าไม่มี" เงียบๆ
// ซึ่งจะสร้างสินทรัพย์ซ้ำแถวใหม่ ทั้งที่ผู้ใช้ถืออยู่จริง
// → ประวัติแตกคนละ asset_id = บั๊กเดียวกับที่ migration 014 เคยแก้เป๊ะ
//
// ── 📌 บทเรียนสำคัญที่สุดของไฟล์นี้ (24 ส.ค. 2569) ─────────────────────────
// คำเตือนข้างบนนี้ **เคยเขียนครอบแค่ `brokerId` อย่างเดียว** แล้วโค้ดในไฟล์นี้เอง
// ก็ไปทำผิดแบบเดียวกันเป๊ะกับ `portfolioId` (Default Parameter `portfolioId = null`
// + Caller ทุกตัวเขียน `?? null` ตามกันหมด) จนกลายเป็นบั๊กที่บล็อกการ Apply
// migration 044 และแตะเงินจริงแบบเงียบสนิท
//
// **คำเตือนที่ครอบไม่ครบ อันตรายกว่าไม่มีคำเตือน** — เพราะคนอ่านเห็นว่ามีคำเตือน
// เรื่องนี้อยู่แล้ว จึงคิดว่า "ตรวจแล้ว" และไม่เอะใจกับมิติที่คำเตือนไม่ได้พูดถึง
// ⚠️ ถ้าเพิ่มมิติที่ 3 (เช่น sub-account) ในอนาคต **ต้องมาขยายคำเตือนนี้ด้วยเสมอ**
// (Post-mortem เต็ม: docs/POSTMORTEM_PORTFOLIO_RESOLUTION.md)

class AssetResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AssetResolutionError';
    this.code = code;
    this.details = details;
  }
}

// ทำให้ค่าโบรกเทียบกันได้แบบเดียวกับที่ DB เทียบ (NULLS NOT DISTINCT)
// ทั้ง null และ undefined ที่ "ผ่านการตัดสินแล้ว" คือแถว broker_id IS NULL
function brokerKey(value) {
  return value ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// resolveOwnedAsset — ทางเข้าเดียวของการแปลง Symbol → asset row
// ═══════════════════════════════════════════════════════════════════════════
// คืน { asset, candidates }
//   asset      = แถวที่ตรงเงื่อนไข หรือ null ถ้ายังไม่มี (Caller ตัดสินเองว่าจะ
//                สร้างใหม่ (buy) หรือโยน ASSET_NOT_FOUND (sell/profit))
//   candidates = ทุกแถวของ Symbol นี้ (เรียงตาม created_at) — Caller ใช้สร้าง
//                ปุ่มให้เลือกได้โดยไม่ต้อง Query ซ้ำ
//
// throw AMBIGUOUS_ASSET_PORTFOLIO เมื่อ "ปลายทางที่เป็นไปได้" ยังกระจายอยู่ >1 พอร์ต
//       และผู้ใช้ยังไม่ได้ระบุพอร์ต
// throw AMBIGUOUS_ASSET_BROKER    เมื่อพอร์ตชัดแล้ว แต่ยังเหลือหลายโบรกและผู้ใช้
//       ยังไม่ได้ระบุโบรก
async function resolveOwnedAsset(userId, symbol, { portfolioId, brokerId } = {}) {
  // ⚠️ **ห้ามใส่ Default `= null` ให้ portfolioId เด็ดขาด** (เคยเป็นแบบนั้นและคือ
  // ต้นตอของบั๊กที่บล็อก migration 044) — undefined ต้องไหลลงไปถึง Repository
  // ตามที่เป็น เพื่อให้แปลว่า "ไม่กรองมิตินี้" ไม่ใช่ "เจาะจงว่าไม่มีพอร์ต"
  const candidates = await assetRepository.findAllByUserAndSymbol(userId, symbol, portfolioId);

  // ── ชั้นที่ 1: หด "ปลายทางที่ยังเป็นไปได้" ตามคำตอบที่ผู้ใช้ให้มาแล้ว ──────────
  // brokerId === undefined = ยังไม่ได้ถาม → ทุกแถวยังเป็นไปได้หมด
  const wantedBroker = brokerKey(brokerId);
  const matchedByBroker =
    brokerId === undefined
      ? candidates
      : candidates.filter((a) => brokerKey(a.brokerId) === wantedBroker);

  // ⚠️ ถ้าโบรกที่ผู้ใช้ระบุ "ยังไม่เคยถือ Symbol นี้" (matchedByBroker ว่าง) แปลว่า
  // ปลายทางคือ **แถวใหม่ที่ยังไม่มี** ซึ่งจะไปลงพอร์ตไหนก็ยังเป็นไปได้ทั้งหมด
  // จึงต้องกลับไปใช้ candidates ทั้งชุดตัดสินความกำกวมของมิติพอร์ต — ไม่ใช่ชุดว่าง
  // (ถ้าใช้ชุดว่าง จะได้ portfolios.size === 0 → ไม่กำกวม → validateBuy ลงพอร์ต
  // Default เงียบๆ ทั้งที่ผู้ใช้ถือ Symbol นี้กระจายอยู่หลายพอร์ต = Silent Default)
  const possible = matchedByBroker.length > 0 ? matchedByBroker : candidates;

  // ── ชั้นที่ 2: ด่านพอร์ต — อยู่ก่อน "ทุก" จุดที่ return แถวสุดท้าย ────────────
  // (ผู้ใช้ระบุพอร์ตมาแล้ว = มิตินี้ไม่กำกวมโดยนิยาม ด่านจึงผ่านทันที ไม่ใช่ถูกข้าม)
  // ⚠️⚠️ **บั๊กรอบที่ 2 (27 ส.ค. 2569) อยู่ตรงนี้เป๊ะ** — เดิม branch ของโบรก
  // `return` ออกไปก่อนจะมาถึงด่านนี้ ทำให้ "ระบุโบรกแล้ว" = ข้ามด่านพอร์ตทั้งหมด
  // แล้ว `.find()` หยิบแถวแรกตาม created_at เงียบๆ (ถือ BTC @ Bitkub ทั้งพอร์ต A
  // และ B → เขียนธุรกรรมเข้าพอร์ตผิด → ต้นทุนเฉลี่ยเพี้ยนพร้อมกันสองพอร์ต)
  //
  // ── ทำไมกรองโบรกก่อน (matchedByBroker) แล้วค่อยตรวจพอร์ต ─────────────────
  // ทางเลือกที่ตรงตัวกว่าคือ "ตรวจ candidates ทั้งชุดก่อนเสมอ ไม่สนโบรก" แต่แบบนั้น
  // จะถามพอร์ตในกรณีที่ **คำตอบมีอยู่ทางเดียวอยู่แล้ว**: ถือ BTC @ Bitkub ในพอร์ต A
  // และ BTC @ Binance ในพอร์ต B — ผู้ใช้ตอบ "Bitkub" มาแล้ว ปลายทางเหลือ A ทางเดียว
  // การถามพอร์ตซ้ำจึงเป็นการเพิ่ม Latency บน Live Path โดยไม่จำเป็น (กฎยืนข้อ 10)
  // การกรองโบรกก่อนให้ผลลัพธ์ "ห้ามหยิบแถวแรกเงียบๆ" เหมือนกันทุกกรณี แต่ถามน้อยกว่า
  //
  // ── ลำดับคำถามที่ผู้ใช้จะเจอเมื่อกำกวมทั้งสองมิติ (2 พอร์ต × 2 โบรก) ──────────
  // ยังไม่ตอบอะไรเลย → matchedByBroker = candidates → ด่านนี้ยิง "ถามพอร์ตก่อน"
  // ตอบพอร์ตแล้ว → candidates ถูกกรองเหลือพอร์ตเดียวตั้งแต่ Repository → ด่านนี้ผ่าน
  // → ตกไปที่ AMBIGUOUS_ASSET_BROKER ข้างล่าง = ถามโบรกเป็นคำถามที่สอง
  // พอร์ตจึงถูกถามก่อนโบรกเสมอเมื่อกำกวมทั้งคู่ (พอร์ตเป็นมิติที่หยาบกว่า และตอบ
  // พอร์ตแล้วมิติโบรกมักเหลือทางเดียวเอง = ไม่ต้องถามรอบสอง)
  //
  // ⚠️ **ห้ามเดาว่าเป็นพอร์ต Default เงียบๆ เด็ดขาด** (กฎยืนข้อ 11) — ผู้ใช้ที่ถือ
  // BTC อยู่ในพอร์ตอื่นแล้วเราไปสร้างแถวใหม่ในพอร์ต Default ให้ = บั๊กเดิม
  // (ประวัติแตกคนละ asset_id) กลับมาในรูปใหม่
  if (portfolioId === undefined) {
    const portfolios = new Set(possible.map((a) => a.portfolioId ?? null));
    if (portfolios.size > 1) {
      throw new AssetResolutionError(
        'AMBIGUOUS_ASSET_PORTFOLIO',
        `Symbol ${symbol} matches ${possible.length} assets across different portfolios`,
        {
          symbol,
          // พก **เฉพาะตัวเลือกที่ยังเป็นไปได้** ไปให้ชั้นบนสร้างปุ่ม — ถ้าผู้ใช้ตอบ
          // โบรกมาแล้ว ต้องไม่โชว์พอร์ตของโบรกอื่นให้กดผิด
          candidates: possible.map((a) => ({
            assetId: a.id,
            portfolioId: a.portfolioId ?? null,
            brokerId: a.brokerId ?? null,
          })),
        }
      );
    }
  }

  // ── ชั้นที่ 3: ผู้ใช้ระบุโบรกมาแล้ว (รวมกรณีระบุว่า "ไม่ระบุโบรก") ────────────
  // ไม่เจอ = ยังไม่เคยถือ Symbol นี้ "ที่โบรกนั้น" ซึ่งเป็นคนละความหมายกับ
  // "ไม่เคยถือ Symbol นี้เลย" แต่ปลายทางเหมือนกัน (buy → สร้างแถวใหม่ของโบรกนั้น)
  if (brokerId !== undefined) {
    // ถึงตรงนี้ matchedByBroker เหลือได้มากสุด 1 แถว **ตราบใดที่ UNIQUE ของ 046
    // ยังอยู่ครบ**: ถ้า portfolioId เป็น
    // undefined ด่านชั้นที่ 2 กรองกรณีหลายพอร์ตออกไปแล้ว · ถ้าระบุพอร์ตมา
    // candidates ถูกกรองเหลือพอร์ตเดียวตั้งแต่ Repository และ UNIQUE NULLS NOT
    // DISTINCT (user_id, symbol, portfolio_id, broker_id) ของ migration 046
    // การันตีว่า (พอร์ต, โบรก) ชุดเดียวกันมีได้แถวเดียว
    // เงื่อนไขนี้จึงไม่ควรเป็นจริง — แต่ถ้าเป็นจริงเมื่อไหร่ให้ "ดัง" ไม่ใช่หยิบแถวแรก
    if (matchedByBroker.length > 1) {
      throw new AssetResolutionError(
        'AMBIGUOUS_ASSET_PORTFOLIO',
        `Symbol ${symbol} matches ${matchedByBroker.length} assets at the same broker`,
        {
          symbol,
          candidates: matchedByBroker.map((a) => ({
            assetId: a.id,
            portfolioId: a.portfolioId ?? null,
            brokerId: a.brokerId ?? null,
          })),
        }
      );
    }
    return { asset: matchedByBroker[0] ?? null, candidates };
  }

  if (candidates.length === 0) return { asset: null, candidates };
  if (candidates.length === 1) return { asset: candidates[0], candidates };

  // ── ชั้นที่ 4: กำกวม — ถือ Symbol นี้อยู่หลายโบรก แต่ยังไม่รู้ว่าหมายถึงโบรกไหน ──
  // details.candidates พก assetId + brokerId ไปให้ชั้นบนสร้างปุ่ม/ตัวเลือกได้เลย
  // (ไม่พกชื่อโบรกมาที่นี่โดยเจตนา — Service ชั้นนี้ไม่ควรรู้จักเรื่องการแสดงผล
  // ชั้น Controller เป็นคน Join ชื่อโบรกเองจาก brokerRepository)
  throw new AssetResolutionError(
    'AMBIGUOUS_ASSET_BROKER',
    `Symbol ${symbol} matches ${candidates.length} assets across different brokers`,
    {
      symbol,
      portfolioId,
      candidates: candidates.map((a) => ({ assetId: a.id, brokerId: a.brokerId ?? null })),
    }
  );
}


module.exports = {
  AssetResolutionError,
  resolveOwnedAsset,
};
