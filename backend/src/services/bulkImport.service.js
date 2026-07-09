const assetRepository = require('../repositories/asset.repository');
const entitlement = require('./entitlement.service');
const symbolRegistry = require('./symbolRegistry.service');
const transactionService = require('./transaction.service');
const commandParser = require('./commandParser.service');
const pendingTransactionService = require('./pendingTransaction.service');

// ═══════════════════════════════════════════════════════════════════════
// bulkImport.service — นำเข้าพอร์ตแบบ Multi-line (Phase 3 Round 6)
// ═══════════════════════════════════════════════════════════════════════
// Error Shape ที่ไหลออกจาก previewBatch (errors[]) มี 2 แบบ ปนกันได้:
//  - Parse-level (จาก commandParser.parseBulkImportLines): { line, reason }
//    reason เป็นข้อความไทยสำเร็จรูปแล้ว (ไม่มี Error Code เพราะเป็น Syntax Error
//    ไม่ใช่ Business Error)
//  - Business-level (จาก validateItems ด้านล่าง): { line, symbol, code }
//    code ต้องแปลผ่าน flexMessage.util.ERROR_MESSAGES ที่ชั้น Controller/View
//    (ไม่ Import flexMessage มาที่ Service Layer — คงการแบ่งชั้นเดิมของโปรเจกต์
//    ที่ Service ไม่รู้จัก LINE Flex Message)
//  - Aggregate Asset Limit (รวมทั้ง Batch ไม่ใช่บรรทัดใดบรรทัดหนึ่ง): { line: null, code }

// ตรวจ Free Plan Asset Limit แบบ "รวมทั้ง Batch" — ต่างจาก transactionService.
// validateBuy ที่เช็คเฉพาะ 1 รายการ (อ่าน countActiveByUser ที่ยังไม่ถูกเขียนจริง
// ระหว่าง Dry-run จึงเห็นค่าเดิมซ้ำทุกรายการ) ถ้าไม่เช็ครวมที่นี่ก่อน การ Import
// หลาย Symbol ใหม่พร้อมกันใน Batch เดียวจะ "หลุด" ผ่าน validateBuy ทีละรายการได้
// ทั้งที่รวมกันเกิน Limit จริง (เช่น มี 1 Asset อยู่แล้ว + Import 3 Symbol ใหม่ =
// 4 ตัว เกิน Limit Free 2 ตัว แต่ validateBuy ทีละตัวเห็น count เดิม=1 ทุกครั้ง
// จึงผ่านหมดทั้ง 3) — ไม่แตะ/ไม่เขียน Logic นับ Asset ใน transactionService ซ้ำ
// เพียงเสริมมุมมอง "รวมทั้ง Batch" ที่ Field เดิมไม่มีให้
async function checkAggregateAssetLimit(userId, items, options) {
  const assetLimit = entitlement.getActiveAssetLimit(options);
  if (assetLimit === null) return null; // Premium Active — ไม่จำกัด

  const existingCount = await assetRepository.countActiveByUser(userId);

  const uniqueSymbols = [...new Set(items.map((item) => item.symbol))];
  let newSymbolCount = 0;
  for (const symbol of uniqueSymbols) {
    const existing = await assetRepository.findByUserAndSymbol(userId, symbol, null);
    if (!existing) newSymbolCount += 1;
  }

  if (existingCount + newSymbolCount > assetLimit) {
    return {
      line: null,
      code: 'ASSET_LIMIT_REACHED',
      details: { limit: assetLimit, current: existingCount, newInBatch: newSymbolCount },
    };
  }

  return null;
}

// Validate ทุกรายการผ่าน transactionService.validateBuy เดิม (ไม่เขียน Logic
// คำนวณ FX/ราคาตลาดใหม่ซ้ำ — Reuse ทั้งหมด) — เก็บ Error "ทุกบรรทัดที่ผิด" ไม่หยุด
// ที่รายการแรก (Requirement: ต้องรายงานครบทุกบรรทัดที่มีปัญหาพร้อมกัน)
// คืน { ok:true, validated: [{ line, symbol, params, amounts, assetType }] }
// หรือ { ok:false, errors }
async function validateItems(userId, items, options) {
  const limitError = await checkAggregateAssetLimit(userId, items, options);
  if (limitError) {
    return { ok: false, errors: [limitError] };
  }

  const errors = [];
  const validated = [];

  for (const item of items) {
    const params = {
      symbol: item.symbol,
      quantity: item.quantity,
      pricePerUnit: item.pricePerUnit,
      ...(item.priceCurrency ? { priceCurrency: item.priceCurrency } : {}),
      ...(item.date ? { date: item.date } : {}),
    };

    // Enrich type จาก Symbol Registry เหมือนที่ webhook.controller.routeCommand ทำ
    // ให้คำสั่งซื้อเดี่ยว (BUY) — Asset ใหม่ที่ยังไม่มี type ต้องเดาจาก Registry ก่อน
    // ปล่อยให้ validateBuy throw VALIDATION_ERROR เองถ้าเดาไม่ได้ (ไม่เดามั่ว)
    if (!params.type) {
      const type = symbolRegistry.lookupType(params.symbol);
      if (type) params.type = type;
    }

    try {
      const result = await transactionService.validateBuy(userId, params, options);
      validated.push({
        line: item.line,
        symbol: item.symbol,
        params,
        amounts: result.amounts,
        assetType: result.newAsset ? result.assetType : null,
      });
    } catch (err) {
      errors.push({ line: item.line, symbol: item.symbol, code: err.code ?? 'INTERNAL_ERROR' });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, validated };
}

// Parse + Validate + Persist Batch ทั้งก้อน (ข้อความที่ 2 ของ Flow นำเข้าพอร์ต)
// คืนผลลัพธ์ 3 แบบ:
//  - { ok:false, empty:true }                 → Batch ว่างเปล่า (ไม่มีบรรทัดที่มีเนื้อหาเลย)
//  - { ok:false, empty:false, errors }         → Parse หรือ Validate ไม่ผ่าน (ไม่เขียน DB
//    เลยแม้แต่แถวเดียว — ทั้ง Asset ใหม่และ Pending)
//  - { ok:true, batchId, items, totalAmountThb } → ผ่านหมด สร้าง Pending Batch แล้ว
async function previewBatch(userId, rawText, options = {}) {
  const parsed = commandParser.parseBulkImportLines(rawText);

  if (!parsed.ok) {
    if (parsed.empty) {
      return { ok: false, empty: true, errors: [] };
    }
    return { ok: false, empty: false, errors: parsed.errors };
  }

  const validation = await validateItems(userId, parsed.items, options);
  if (!validation.ok) {
    return { ok: false, empty: false, errors: validation.errors };
  }

  const { batchId, pendings } = await pendingTransactionService.createBatch(
    userId,
    validation.validated
  );

  const totalAmountThb = pendings.reduce((sum, p) => sum + Number(p.amountThb), 0);

  return { ok: true, batchId, items: pendings, totalAmountThb };
}

// ยืนยัน/ยกเลิก Batch — Wrapper บาง ๆ ให้ Controller เรียกผ่าน Service Layer เดียวกัน
// (ไม่แตะ pendingTransactionService ตรงจาก Controller — Layering เดียวกับจุดอื่น)
async function confirmBatch(batchId) {
  return pendingTransactionService.confirmBatch(batchId);
}

async function cancelBatch(batchId) {
  return pendingTransactionService.cancelBatch(batchId);
}

module.exports = {
  previewBatch,
  confirmBatch,
  cancelBatch,
};
