jest.mock('../src/services/priceFeed.service');

const priceFeedService = require('../src/services/priceFeed.service');
const {
  resolveFundForBuy,
  autoSelectClass,
  getFundClass,
  getProjectById,
  MutualFundError,
} = require('../src/services/mutualFund.service');

// K-SELECT มี 3 Class (proj เดียว), SCBRM มี 1 Class
const MASTER = [
  { proj_id: 'M0001', proj_abbr_name: 'K-SELECT', proj_name_th: 'เค ซีเล็คท์', fund_class_name: 'K-SELECT-A(A)', fund_class_detail: 'ชนิดสะสมมูลค่า' },
  { proj_id: 'M0001', proj_abbr_name: 'K-SELECT', proj_name_th: 'เค ซีเล็คท์', fund_class_name: 'K-SELECT-A(D)', fund_class_detail: 'ชนิดจ่ายปันผล' },
  { proj_id: 'M0001', proj_abbr_name: 'K-SELECT', proj_name_th: 'เค ซีเล็คท์', fund_class_name: 'K-SELECT-C(A)', fund_class_detail: 'ชนิดผู้ลงทุนสถาบัน' },
  { proj_id: 'M0002', proj_abbr_name: 'SCBRM', proj_name_th: 'ไทยพาณิชย์', fund_class_name: 'SCBRM', fund_class_detail: 'ชนิดเดียว' },
];

beforeEach(() => {
  jest.clearAllMocks();
  priceFeedService.fetchFundMasterList.mockResolvedValue(MASTER);
});

describe('resolveFundForBuy — (a) กองทุน Class เดียว → single (ไม่ถาม)', () => {
  test('SCBRM → single พร้อม fundClass', async () => {
    const result = await resolveFundForBuy('SCBRM');
    expect(result.status).toBe('single');
    expect(result.fundClass).toMatchObject({ projId: 'M0002', fundClassName: 'SCBRM' });
  });

  test('Case-insensitive: "scbrm" → single', async () => {
    const result = await resolveFundForBuy('scbrm');
    expect(result.status).toBe('single');
  });
});

describe('resolveFundForBuy — (b) กองทุนหลาย Class → multiple (ต้องถาม)', () => {
  test('K-SELECT → multiple พร้อม classes ครบ 3 (เรียงตามลำดับ API)', async () => {
    const result = await resolveFundForBuy('K-SELECT');
    expect(result.status).toBe('multiple');
    expect(result.project.classes.map((c) => c.fundClassName)).toEqual([
      'K-SELECT-A(A)',
      'K-SELECT-A(D)',
      'K-SELECT-C(A)',
    ]);
  });
});

describe('resolveFundForBuy — (g) ไม่พบกองทุน', () => {
  test('ชื่อที่ไม่มีในระบบ → not_found', async () => {
    expect((await resolveFundForBuy('NOTEXIST')).status).toBe('not_found');
  });

  test('Query ว่าง → not_found (ไม่ยิง Master List เกินจำเป็น)', async () => {
    expect((await resolveFundForBuy('')).status).toBe('not_found');
  });
});

describe('autoSelectClass — (c) Priority ตอนผู้ใช้กด "ไม่แน่ใจ"', () => {
  test('(a) มี Class ชื่อตรง proj_abbr_name เป๊ะ → เลือกตัวนั้น', async () => {
    const project = {
      projId: 'M9',
      projAbbrName: 'ABC',
      classes: [
        { projId: 'M9', fundClassName: 'ABC-A' },
        { projId: 'M9', fundClassName: 'ABC' }, // ตรงเป๊ะ
        { projId: 'M9', fundClassName: 'ABC-C' },
      ],
    };
    expect(autoSelectClass(project).fundClassName).toBe('ABC');
  });

  test('(b) ไม่มี Class ตรงเป๊ะ → เลือก Class แรกตามลำดับ API', async () => {
    const project = {
      projId: 'M0001',
      projAbbrName: 'K-SELECT',
      classes: [
        { projId: 'M0001', fundClassName: 'K-SELECT-A(A)' },
        { projId: 'M0001', fundClassName: 'K-SELECT-A(D)' },
      ],
    };
    expect(autoSelectClass(project).fundClassName).toBe('K-SELECT-A(A)');
  });
});

describe('getFundClass / getProjectById — Re-derive จาก Master List (สำหรับ Postback)', () => {
  test('getFundClass(projId, className) → คืน fundClass ที่ถูกต้อง', async () => {
    const fc = await getFundClass('M0001', 'K-SELECT-A(D)');
    expect(fc).toMatchObject({ fundClassName: 'K-SELECT-A(D)', fundClassDetail: 'ชนิดจ่ายปันผล' });
  });

  test('getFundClass ไม่พบ Class → throw FUND_CLASS_NOT_FOUND', async () => {
    await expect(getFundClass('M0001', 'K-SELECT-Z')).rejects.toMatchObject({
      code: 'FUND_CLASS_NOT_FOUND',
    });
  });

  test('getProjectById → คืน project พร้อมทุก Class (ใช้ Auto-select ต่อ)', async () => {
    const project = await getProjectById('M0001');
    expect(project.classes).toHaveLength(3);
    expect(autoSelectClass(project).fundClassName).toBe('K-SELECT-A(A)'); // (b) ตัวแรก
  });
});

describe('resolveFundForBuy — (f) Error Isolation: SEC ล่ม/ไม่ config → โยน Error ต่อ', () => {
  test('fetchFundMasterList throw SEC_NOT_CONFIGURED → โยนต่อ (Controller ปล่อยผ่าน)', async () => {
    priceFeedService.fetchFundMasterList.mockRejectedValue(
      Object.assign(new Error('not configured'), { code: 'SEC_NOT_CONFIGURED' })
    );
    await expect(resolveFundForBuy('K-SELECT')).rejects.toMatchObject({ code: 'SEC_NOT_CONFIGURED' });
  });

  test('Master List มี Row ที่ขาด Field (Defensive) → ไม่ Crash, ข้าม Row นั้น', async () => {
    priceFeedService.fetchFundMasterList.mockResolvedValue([
      { proj_id: 'M0002', proj_abbr_name: 'SCBRM', fund_class_name: 'SCBRM' },
      { proj_abbr_name: 'BROKEN' }, // ขาด proj_id + fund_class_name
      null,
    ]);
    const result = await resolveFundForBuy('SCBRM');
    expect(result.status).toBe('single');
  });
});
