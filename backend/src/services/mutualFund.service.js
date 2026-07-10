const priceFeedService = require('./priceFeed.service');

// ═══════════════════════════════════════════════════════════════════════
// mutualFund.service — จับคู่ชื่อกองทุนที่ผู้ใช้พิมพ์ ↔ proj_id + fund_class_name
// ═══════════════════════════════════════════════════════════════════════
// แยกหน้าที่กับ priceFeed.service ชัดเจน (Pattern เดียวกับ symbolRegistry ↔ priceFeed):
//   - priceFeed.service = "ยิง SEC API + Cache" (fetchFundMasterList / getMutualFundNav)
//   - mutualFund.service = "Logic การ Match ชื่อ + เลือก Class" (Pure-ish, ใช้ Master List)
//
// ⚠️ Endpoint 2 (Master List) ยัง UNVERIFIED — Field ที่ใช้ (proj_id, proj_abbr_name,
// proj_name_th, fund_class_name, fund_class_detail) อ่านแบบ Defensive (เช็คก่อนใช้
// ไม่ Assume Type/มีครบ) เผื่อ Response จริงต่างจากตัวอย่างที่ Product Owner เห็น

// Error ที่มี code ให้ Controller แปลไทยได้ (Pattern เดียวกับ Service อื่น)
class MutualFundError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MutualFundError';
    this.code = code;
    this.details = details;
  }
}

function norm(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

// ปรับ 1 Row ดิบจาก Master List เป็นรูปที่ใช้ต่อได้ (อ่าน Field แบบ Defensive)
// คืน null ถ้าขาด Field จำเป็น (proj_id หรือ fund_class_name) — Row นั้นใช้ไม่ได้
function toFundClass(row) {
  if (!row || typeof row !== 'object') return null;
  const projId = typeof row.proj_id === 'string' ? row.proj_id : null;
  const fundClassName = typeof row.fund_class_name === 'string' ? row.fund_class_name : null;
  if (!projId || !fundClassName) return null;

  return {
    projId,
    fundClassName,
    projAbbrName: typeof row.proj_abbr_name === 'string' ? row.proj_abbr_name : '',
    projNameTh: typeof row.proj_name_th === 'string' ? row.proj_name_th : '',
    fundClassDetail: typeof row.fund_class_detail === 'string' ? row.fund_class_detail : '',
  };
}

// จัดกลุ่ม Row ที่ Match เป็นราย proj_id (กองทุนเดียวกัน) — คืน Array ของ
// { projId, projAbbrName, projNameTh, classes: [{ fundClassName, fundClassDetail, projId, ... }] }
// เรียง classes ตามลำดับที่ API คืนมา (ไม่ Sort เพิ่ม — ใช้ลำดับนี้ตอน Auto-select ข้อ (b))
function groupByProject(rows) {
  const byProj = new Map();
  for (const raw of rows) {
    const fc = toFundClass(raw);
    if (!fc) continue;
    if (!byProj.has(fc.projId)) {
      byProj.set(fc.projId, {
        projId: fc.projId,
        projAbbrName: fc.projAbbrName,
        projNameTh: fc.projNameTh,
        classes: [],
      });
    }
    byProj.get(fc.projId).classes.push(fc);
  }
  return Array.from(byProj.values());
}

// เลือก Class อัตโนมัติเมื่อผู้ใช้กด "ไม่แน่ใจ" — ตาม Priority ที่ตกลงไว้:
//   (a) Class ที่ fund_class_name ตรงกับ proj_abbr_name เป๊ะ (ไม่มีต่อท้าย) เช่น
//       proj_abbr_name = "K-SELECT" และมี Class ชื่อ "K-SELECT" พอดี → ใช้ตัวนั้น
//   (b) ถ้าไม่มีแบบ (a) → Class แรกตามลำดับที่ API คืนมา (ไม่เดา "ตัวหลัก" ด้วย Heuristic อื่น)
function autoSelectClass(project) {
  const classes = project.classes || [];
  if (classes.length === 0) return null;

  const abbr = norm(project.projAbbrName);
  const exact = classes.find((c) => norm(c.fundClassName) === abbr && abbr !== '');
  return exact || classes[0];
}

// ค้นหากองทุนจากชื่อย่อที่ผู้ใช้พิมพ์ — Exact match (case-insensitive) บน
// proj_abbr_name ก่อน ถ้าไม่เจอค่อย Contains แบบง่าย (ไม่ทำ Full Fuzzy)
// คืน:
//   { status: 'not_found' }
//   { status: 'single',   project, fundClass }           — Class เดียว ใช้เลย
//   { status: 'multiple', project }                        — หลาย Class ต้องถาม
// throw SEC_NOT_CONFIGURED / MUTUAL_FUND_LIST_UNAVAILABLE ถ้าดึง Master List ไม่ได้
// (Controller จะแยกแยะ: Config ไม่พร้อม → ปล่อยผ่านเป็น "ไม่รู้จักสินทรัพย์" ตามเดิม)
async function resolveFundForBuy(query) {
  const q = norm(query);
  if (!q) return { status: 'not_found' };

  const rows = await priceFeedService.fetchFundMasterList(); // อาจ throw (Config/HTTP)

  // Exact match บน proj_abbr_name ก่อน
  let matched = rows.filter((r) => norm(r?.proj_abbr_name) === q);
  // ไม่เจอ Exact → ลอง Contains (ทั้งสองทาง) แบบง่าย
  if (matched.length === 0) {
    matched = rows.filter((r) => {
      const abbr = norm(r?.proj_abbr_name);
      return abbr !== '' && (abbr.includes(q) || q.includes(abbr));
    });
  }

  if (matched.length === 0) return { status: 'not_found' };

  const projects = groupByProject(matched);
  if (projects.length === 0) return { status: 'not_found' };

  // ถ้า Contains คร่อมหลายกองทุน — เลือกกองที่ proj_abbr_name ตรง q เป๊ะที่สุดก่อน
  // (กัน "K" ไป Match หลายกอง) ถ้ายังมีหลายกองที่ไม่มีตัวตรงเป๊ะ → ถือว่ากำกวม =
  // not_found (ให้ผู้ใช้พิมพ์ชื่อย่อให้ชัด ตาม Scope: ไม่ทำ Did-you-mean)
  let project = projects.find((p) => norm(p.projAbbrName) === q);
  if (!project) {
    if (projects.length > 1) return { status: 'not_found' };
    project = projects[0];
  }

  if (project.classes.length === 1) {
    return { status: 'single', project, fundClass: project.classes[0] };
  }
  return { status: 'multiple', project };
}

// ดึงรายละเอียด Class เจาะจง (projId + fundClassName) จาก Master List — ใช้ตอน
// Postback ผู้ใช้เลือก Class แล้ว (Re-derive ชื่อ/รายละเอียดจาก Cache ไม่ต้องพก
// ผ่าน Postback data ให้ยาว) คืน fundClass object หรือ throw FUND_CLASS_NOT_FOUND
async function getFundClass(projId, fundClassName) {
  const rows = await priceFeedService.fetchFundMasterList();
  const project = groupByProject(rows.filter((r) => r?.proj_id === projId))[0];
  const fc = project?.classes.find((c) => c.fundClassName === fundClassName);
  if (!fc) {
    throw new MutualFundError(
      'FUND_CLASS_NOT_FOUND',
      `Fund class ${fundClassName} not found for ${projId}`,
      { projId, fundClassName }
    );
  }
  return fc;
}

// ดึง Project (พร้อมทุก Class) ตาม projId — ใช้ตอน Postback "ไม่แน่ใจ" เพื่อ
// Auto-select ตาม Priority คืน project หรือ throw FUND_CLASS_NOT_FOUND
async function getProjectById(projId) {
  const rows = await priceFeedService.fetchFundMasterList();
  const project = groupByProject(rows.filter((r) => r?.proj_id === projId))[0];
  if (!project) {
    throw new MutualFundError('FUND_CLASS_NOT_FOUND', `Fund ${projId} not found`, { projId });
  }
  return project;
}

module.exports = {
  MutualFundError,
  resolveFundForBuy,
  autoSelectClass,
  getFundClass,
  getProjectById,
  // Export ไว้ให้ Test/Reuse
  groupByProject,
};
