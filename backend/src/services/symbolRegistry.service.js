// Symbol → asset type mapping แบบ Hardcode สำหรับสินทรัพย์ยอดนิยม
// type อ้างอิงจาก DATABASE.md § assets — CHECK (type IN
// ('crypto', 'stock_th', 'stock_us', 'etf', 'fund', 'gold_bar', 'gold_ornament'))
//
// นี่เป็นทางเลือกชั่วคราวก่อนจะมี Market Data Service จริง — ครอบคลุมเฉพาะ
// สินทรัพย์ที่พบบ่อยเท่านั้น ถ้าไม่รู้จัก Symbol จะคืน null (ไม่เดา type มั่ว)
// เพื่อไม่ให้บันทึกสินทรัพย์ที่จำแนกประเภทผิดลง DB
const SYMBOL_TYPES = {
  // ── Crypto ──────────────────────────────────────────────────────────
  BTC: 'crypto',
  ETH: 'crypto',
  USDT: 'crypto',
  BNB: 'crypto',
  XRP: 'crypto',
  SOL: 'crypto',
  DOGE: 'crypto',
  ADA: 'crypto',

  // ── หุ้นไทย (SET) ───────────────────────────────────────────────────
  PTT: 'stock_th',
  CPALL: 'stock_th',
  AOT: 'stock_th',
  ADVANC: 'stock_th',
  SCB: 'stock_th',
  KBANK: 'stock_th',
  BBL: 'stock_th',
  SET: 'stock_th',
  PTTEP: 'stock_th',
  SCC: 'stock_th',
  GULF: 'stock_th',
  INTUCH: 'stock_th',
  TRUE: 'stock_th',
  DELTA: 'stock_th',
  OR: 'stock_th',
  GPSC: 'stock_th',
  BDMS: 'stock_th',
  CPN: 'stock_th',
  MINT: 'stock_th',
  KTB: 'stock_th',
  TTB: 'stock_th',
  CPF: 'stock_th',
  IVL: 'stock_th',
  EA: 'stock_th',

  // ── หุ้นสหรัฐ ─────────────────────────────────────────────────────────
  AAPL: 'stock_us',
  GOOGL: 'stock_us',
  MSFT: 'stock_us',
  TSLA: 'stock_us',
  AMZN: 'stock_us',
  NVDA: 'stock_us',
  META: 'stock_us',

  // ── ขยาย List (Beta Prep) — เพิ่มความครอบคลุมก่อนเปิด Beta หลังพบว่า AMD
  // หายไปจาก List เดิม (Dynamic Symbol Resolution ผ่าน API ยังไม่ทำ — ตัดสินใจ
  // แล้วว่าเป็น Scope แยกต่างหาก) ทุกตัวด้านล่างนี้ Route ไป Twelve Data /quote
  // เหมือนกันทั้งหมด (ราคาปิดล่าสุดเป็น USD) — Twelve Data คืนราคาแบบเดียวกัน
  // ทั้งหุ้นเดี่ยวและ ETF (ดู priceFeed.service.getUsStockPriceThb/
  // getCurrentPriceUsd ที่ Route เฉพาะ type==='stock_us' เท่านั้น — 'etf' ไม่มี
  // Route ราคาเลยในระบบตอนนี้ จึงจงใจไม่ใช้ type 'etf' แม้จะมีอยู่ใน DB CHECK
  // Constraint ก็ตาม เพื่อไม่ให้ ETF ที่เพิ่มเข้ามาใช้งานจริงไม่ได้เลย)
  //
  // Magnificent 7 (ส่วนที่เหลือจาก List เดิม)
  GOOG: 'stock_us', // Alphabet Class C (ต่างจาก GOOGL Class A ที่มีอยู่แล้ว)

  // เซมิคอนดักเตอร์
  AMD: 'stock_us',
  INTC: 'stock_us',
  AVGO: 'stock_us',
  QCOM: 'stock_us',
  TXN: 'stock_us',
  MU: 'stock_us',
  AMAT: 'stock_us',
  LRCX: 'stock_us',
  KLAC: 'stock_us',
  ADI: 'stock_us',
  MRVL: 'stock_us',
  ON: 'stock_us',
  MCHP: 'stock_us',
  NXPI: 'stock_us',
  ASML: 'stock_us', // ADR (เนเธอร์แลนด์) เทรดเป็น USD บน NASDAQ
  TSM: 'stock_us', // ADR (ไต้หวัน) เทรดเป็น USD บน NYSE
  ARM: 'stock_us', // ADR (สหราชอาณาจักร) เทรดเป็น USD บน NASDAQ
  SWKS: 'stock_us',

  // ซอฟต์แวร์/คลาวด์/อินเทอร์เน็ต
  ORCL: 'stock_us',
  CRM: 'stock_us',
  ADBE: 'stock_us',
  NOW: 'stock_us',
  INTU: 'stock_us',
  SNOW: 'stock_us',
  PLTR: 'stock_us',
  PANW: 'stock_us',
  CRWD: 'stock_us',
  FTNT: 'stock_us',
  NET: 'stock_us',
  DDOG: 'stock_us',
  TEAM: 'stock_us',
  WDAY: 'stock_us',
  SHOP: 'stock_us', // ADR (แคนาดา) เทรดเป็น USD บน NYSE
  UBER: 'stock_us',
  ABNB: 'stock_us',
  BKNG: 'stock_us',
  NFLX: 'stock_us',
  SPOT: 'stock_us', // ADR (ลักเซมเบิร์ก) เทรดเป็น USD บน NYSE
  PYPL: 'stock_us',
  SQ: 'stock_us',
  COIN: 'stock_us',
  IBM: 'stock_us',
  CSCO: 'stock_us',
  HPQ: 'stock_us',
  DELL: 'stock_us',

  // การเงิน/ธนาคาร
  JPM: 'stock_us',
  BAC: 'stock_us',
  WFC: 'stock_us',
  C: 'stock_us',
  GS: 'stock_us',
  MS: 'stock_us',
  V: 'stock_us',
  MA: 'stock_us',
  AXP: 'stock_us',
  BLK: 'stock_us',
  SCHW: 'stock_us',
  SPGI: 'stock_us',
  ICE: 'stock_us',
  CME: 'stock_us',
  // มีจุดใน Symbol (Share Class B) — ทดสอบแล้วว่า Command Parser (\S+ Token
  // Boundary ด้วยช่องว่าง) Parse ผ่านปกติทุกรูปแบบคำสั่ง ไม่ชนกับ Regex ใดๆ
  // ⚠️ ยังไม่ได้ยืนยันกับ Twelve Data จริงว่ารับ Symbol รูปแบบ "BRK.B" (มีจุด)
  // ตรงๆ หรือต้องการ Format อื่น (เช่น BRK-B/BRKB) — Flag ไว้ให้ทดสอบยิง API
  // จริงก่อน Rely บน Symbol นี้ (ดูสรุปงาน)
  'BRK.B': 'stock_us',
  USB: 'stock_us',
  PNC: 'stock_us',
  TFC: 'stock_us',

  // สุขภาพ/เวชภัณฑ์
  JNJ: 'stock_us',
  UNH: 'stock_us',
  PFE: 'stock_us',
  MRK: 'stock_us',
  ABBV: 'stock_us',
  LLY: 'stock_us',
  TMO: 'stock_us',
  ABT: 'stock_us',
  DHR: 'stock_us',
  BMY: 'stock_us',
  AMGN: 'stock_us',
  GILD: 'stock_us',
  CVS: 'stock_us',
  MDT: 'stock_us',
  ISRG: 'stock_us',
  VRTX: 'stock_us',
  REGN: 'stock_us',
  ZTS: 'stock_us',
  CI: 'stock_us',
  ELV: 'stock_us',

  // สินค้าอุปโภคบริโภค/ค้าปลีก
  WMT: 'stock_us',
  COST: 'stock_us',
  HD: 'stock_us',
  LOW: 'stock_us',
  TGT: 'stock_us',
  PG: 'stock_us',
  KO: 'stock_us',
  PEP: 'stock_us',
  MCD: 'stock_us',
  SBUX: 'stock_us',
  NKE: 'stock_us',
  DIS: 'stock_us',
  CMCSA: 'stock_us',
  MDLZ: 'stock_us',
  CL: 'stock_us',
  EL: 'stock_us',
  YUM: 'stock_us',
  CMG: 'stock_us',
  LULU: 'stock_us',
  TJX: 'stock_us',
  ROST: 'stock_us',
  DG: 'stock_us',
  KHC: 'stock_us',
  MO: 'stock_us',
  PM: 'stock_us',

  // พลังงาน
  XOM: 'stock_us',
  CVX: 'stock_us',
  COP: 'stock_us',
  SLB: 'stock_us',
  OXY: 'stock_us',
  PSX: 'stock_us',
  VLO: 'stock_us',
  MPC: 'stock_us',
  KMI: 'stock_us',
  WMB: 'stock_us',
  NEE: 'stock_us',

  // อุตสาหกรรม
  BA: 'stock_us',
  CAT: 'stock_us',
  HON: 'stock_us',
  GE: 'stock_us',
  UPS: 'stock_us',
  RTX: 'stock_us',
  LMT: 'stock_us',
  NOC: 'stock_us',
  DE: 'stock_us',
  MMM: 'stock_us',
  UNP: 'stock_us',
  FDX: 'stock_us',
  EMR: 'stock_us',
  ETN: 'stock_us',
  GD: 'stock_us',

  // ยานยนต์/EV
  F: 'stock_us',
  GM: 'stock_us',
  RIVN: 'stock_us',
  LCID: 'stock_us',
  TM: 'stock_us', // ADR (ญี่ปุ่น) เทรดเป็น USD บน NYSE

  // สื่อสาร/มีเดีย
  T: 'stock_us',
  VZ: 'stock_us',
  TMUS: 'stock_us',
  WBD: 'stock_us',

  // REITs
  AMT: 'stock_us',
  PLD: 'stock_us',
  O: 'stock_us',
  SPG: 'stock_us',

  // ETF ยอดนิยม — Route ผ่าน Twelve Data เหมือนหุ้นเดี่ยวทุกประการ (เหตุผลด้านบน)
  SPY: 'stock_us',
  VOO: 'stock_us',
  VTI: 'stock_us',
  QQQ: 'stock_us',
  DIA: 'stock_us',
  IWM: 'stock_us',
  SCHD: 'stock_us',
  VYM: 'stock_us',
  VIG: 'stock_us',
  VXUS: 'stock_us',
  VEA: 'stock_us',
  VWO: 'stock_us',
  ARKK: 'stock_us',
  XLK: 'stock_us',
  XLF: 'stock_us',
  XLE: 'stock_us',
  XLV: 'stock_us',
  SOXX: 'stock_us',
  SMH: 'stock_us',
  // ⚠️ GLD/SLV คือ ETF ทองคำ/เงินแบบ USD (ราคาตาม NAV ของกองทุน ผ่าน Twelve
  // Data) คนละแนวคิดกับ GOLD/GOLDORN เดิมที่เป็นราคา "บาททองคำ" ผ่าน Thai Gold
  // API โดยเฉพาะ — ไม่ใช่ Symbol เดียวกัน ไม่ชนกัน แต่ผู้ใช้อาจสับสนได้ระหว่าง
  // "ซื้อทอง" (คำสั่งพิเศษ/GOLD) กับ "ซื้อ GLD" (ETF ธรรมดา ราคา USD)
  GLD: 'stock_us',
  SLV: 'stock_us',
  TLT: 'stock_us',
  BND: 'stock_us',
  JEPI: 'stock_us',
  SCHG: 'stock_us',

  // อื่นๆ ที่นิยมในหมู่นักลงทุนรายย่อย
  NIO: 'stock_us', // ADR (จีน) เทรดเป็น USD บน NYSE
  BABA: 'stock_us', // ADR (จีน) เทรดเป็น USD บน NYSE
  SOFI: 'stock_us',
  RBLX: 'stock_us',
  U: 'stock_us',
  DOCU: 'stock_us',
  ZM: 'stock_us',
  PINS: 'stock_us',
  SNAP: 'stock_us',
  TWLO: 'stock_us',
  // Small-cap ที่ผู้ใช้ถือจริงผ่าน Manual Quantity Fallback (Round 10-B) — ยืนยัน
  // Twelve Data /quote คืนราคาปกติสำหรับ Symbol นี้ (NASDAQ, USD) ก่อนหน้านี้ไม่ได้
  // ลงทะเบียนไว้ ทำให้ lookupType คืน null และ getCurrentPrice/getCurrentPriceUsd
  // ไม่เคยยิง Twelve Data เลย (ไม่ใช่ Twelve Data ล่ม)
  EOSE: 'stock_us', // Eos Energy Enterprises (NASDAQ)
  // Small-cap อีกตัวที่เคยถูก Flag ไว้คู่กับ EOSE (บั๊กเดียวกัน — ยืนยัน Twelve Data
  // /quote จริงแล้วว่ามี Ticker นี้: name="Oklo Inc.", exchange="NYSE", currency="USD")
  OKLO: 'stock_us', // Oklo Inc. (NYSE)

  // ── ทองคำ (Phase 3 Round 7) — ราคาเป็น "บาททองคำ" (น้ำหนัก) ผ่าน Thai Gold API ──
  // แยก 2 Symbol ตาม 2 ประเภทที่ราคาต่างกัน (ทองรูปพรรณมีค่ากำเหน็จ):
  //   GOLD    = ทองคำแท่ง (gold_bar)      — สินทรัพย์ลงทุนหลัก จึงใช้ชื่อสั้นสุด "GOLD"
  //   GOLDORN = ทองรูปพรรณ (gold_ornament) — "ORN" = ornament สื่อความชัด ไม่ชนกับ Symbol อื่น
  GOLD: 'gold_bar',
  GOLDORN: 'gold_ornament',
};

// Symbol → ชื่อแสดงผล (ไทย/อังกฤษ) — เพิ่มใหม่แยก Map ต่างหากจาก SYMBOL_TYPES
// โดยเจตนา (Additive): SYMBOL_TYPES คือ "แหล่งความจริงว่าระบบรองรับ Symbol ใด"
// ซึ่งมีหลายไฟล์พึ่ง Shape เดิมอยู่ (symbol → type ตรงๆ) การยัดชื่อเข้าไปใน Map
// เดิมจะทำให้ lookupType ทุกจุดพัง — จึงแยกเก็บชื่อไว้ที่นี่แทน
//
// ใช้สำหรับ Dropdown ค้นหาสินทรัพย์บนเว็บ (GET /api/v1/assets/symbols) เท่านั้น
// ไม่มีผลต่อการจำแนก type/การดึงราคา/การบันทึกธุรกรรมใดๆ
//
// ที่มาของชื่อ: ตัวแปร SYMBOLS ใน Mockup design/easydca-dashboard-redesign.html
// (ตรวจแล้วว่า Symbol ตรงกับ SYMBOL_TYPES ครบ 224 ตัว ไม่ขาดไม่เกิน และ type ตรงกัน
// ทุกตัว) — Symbol ที่ไม่มีชื่อใน Map นี้ listSymbols จะ Fallback ใช้ Symbol เป็นชื่อ
// แทน (ไม่ทำให้หายไปจาก Dropdown)
const SYMBOL_NAMES = {
  // ── Crypto ──────────────────────────────────────────────────
  BTC: 'Bitcoin บิตคอยน์',
  ETH: 'Ethereum อีเธอเรียม',
  USDT: 'Tether',
  BNB: 'BNB ไบแนนซ์คอยน์',
  XRP: 'XRP ริปเปิล',
  SOL: 'Solana โซลานา',
  DOGE: 'Dogecoin ด็อจคอยน์',
  ADA: 'Cardano คาร์ดาโน',

  // ── หุ้นไทย (SET) ───────────────────────────────────────────
  PTT: 'ปตท.',
  CPALL: 'ซีพี ออลล์ (เซเว่น)',
  AOT: 'ท่าอากาศยานไทย',
  ADVANC: 'แอดวานซ์ (AIS)',
  SCB: 'ไทยพาณิชย์ (SCBX)',
  KBANK: 'กสิกรไทย',
  BBL: 'กรุงเทพ',
  SET: 'ดัชนี SET50',
  PTTEP: 'ปตท.สผ.',
  SCC: 'ปูนซิเมนต์ไทย',
  GULF: 'กัลฟ์',
  INTUCH: 'อินทัช',
  TRUE: 'ทรู คอร์ปอเรชั่น',
  DELTA: 'เดลต้า',
  OR: 'ปตท. น้ำมันและการค้าปลีก',
  GPSC: 'โกลบอล เพาเวอร์',
  BDMS: 'กรุงเทพดุสิตเวชการ',
  CPN: 'เซ็นทรัลพัฒนา',
  MINT: 'ไมเนอร์',
  KTB: 'กรุงไทย',
  TTB: 'ทีเอ็มบีธนชาต',
  CPF: 'เจริญโภคภัณฑ์อาหาร',
  IVL: 'อินโดรามา',
  EA: 'พลังงานบริสุทธิ์',

  // ── หุ้นสหรัฐ / ETF ─────────────────────────────────────────
  AAPL: 'Apple แอปเปิล',
  GOOGL: 'Alphabet (Google) A',
  MSFT: 'Microsoft ไมโครซอฟท์',
  TSLA: 'Tesla เทสลา',
  AMZN: 'Amazon แอมะซอน',
  NVDA: 'NVIDIA เอ็นวิเดีย',
  META: 'Meta (Facebook)',
  GOOG: 'Alphabet (Google) C',
  AMD: 'Advanced Micro Devices เอเอ็มดี',
  INTC: 'Intel อินเทล',
  AVGO: 'Broadcom',
  QCOM: 'Qualcomm',
  TXN: 'Texas Instruments',
  MU: 'Micron',
  AMAT: 'Applied Materials',
  LRCX: 'Lam Research',
  KLAC: 'KLA Corp',
  ADI: 'Analog Devices',
  MRVL: 'Marvell',
  ON: 'ON Semiconductor',
  MCHP: 'Microchip',
  NXPI: 'NXP Semiconductors',
  ASML: 'ASML (ADR เนเธอร์แลนด์)',
  TSM: 'TSMC (ADR ไต้หวัน)',
  ARM: 'Arm Holdings (ADR)',
  SWKS: 'Skyworks',
  ORCL: 'Oracle ออราเคิล',
  CRM: 'Salesforce',
  ADBE: 'Adobe อะโดบี',
  NOW: 'ServiceNow',
  INTU: 'Intuit',
  SNOW: 'Snowflake',
  PLTR: 'Palantir พาลันเทียร์',
  PANW: 'Palo Alto Networks',
  CRWD: 'CrowdStrike',
  FTNT: 'Fortinet',
  NET: 'Cloudflare',
  DDOG: 'Datadog',
  TEAM: 'Atlassian',
  WDAY: 'Workday',
  SHOP: 'Shopify (ADR แคนาดา)',
  UBER: 'Uber อูเบอร์',
  ABNB: 'Airbnb แอร์บีเอ็นบี',
  BKNG: 'Booking Holdings',
  NFLX: 'Netflix เน็ตฟลิกซ์',
  SPOT: 'Spotify สปอติฟาย',
  PYPL: 'PayPal เพย์พาล',
  SQ: 'Block (Square)',
  COIN: 'Coinbase คอยน์เบส',
  IBM: 'IBM ไอบีเอ็ม',
  CSCO: 'Cisco ซิสโก้',
  HPQ: 'HP เอชพี',
  DELL: 'Dell เดลล์',
  JPM: 'JPMorgan Chase',
  BAC: 'Bank of America',
  WFC: 'Wells Fargo',
  C: 'Citigroup ซิตี้กรุ๊ป',
  GS: 'Goldman Sachs',
  MS: 'Morgan Stanley',
  V: 'Visa วีซ่า',
  MA: 'Mastercard มาสเตอร์การ์ด',
  AXP: 'American Express',
  BLK: 'BlackRock',
  SCHW: 'Charles Schwab',
  SPGI: 'S&P Global',
  ICE: 'Intercontinental Exchange',
  CME: 'CME Group',
  'BRK.B': 'Berkshire Hathaway B',
  USB: 'US Bancorp',
  PNC: 'PNC Financial',
  TFC: 'Truist',
  JNJ: 'Johnson & Johnson',
  UNH: 'UnitedHealth',
  PFE: 'Pfizer ไฟเซอร์',
  MRK: 'Merck',
  ABBV: 'AbbVie',
  LLY: 'Eli Lilly',
  TMO: 'Thermo Fisher',
  ABT: 'Abbott',
  DHR: 'Danaher',
  BMY: 'Bristol Myers Squibb',
  AMGN: 'Amgen',
  GILD: 'Gilead',
  CVS: 'CVS Health',
  MDT: 'Medtronic',
  ISRG: 'Intuitive Surgical',
  VRTX: 'Vertex Pharma',
  REGN: 'Regeneron',
  ZTS: 'Zoetis',
  CI: 'Cigna',
  ELV: 'Elevance Health',
  WMT: 'Walmart วอลมาร์ท',
  COST: 'Costco คอสต์โก',
  HD: 'Home Depot',
  LOW: "Lowe's",
  TGT: 'Target ทาร์เก็ต',
  PG: 'Procter & Gamble',
  KO: 'Coca-Cola โคคา-โคล่า',
  PEP: 'PepsiCo เป๊ปซี่',
  MCD: "McDonald's แมคโดนัลด์",
  SBUX: 'Starbucks สตาร์บัคส์',
  NKE: 'Nike ไนกี้',
  DIS: 'Walt Disney ดิสนีย์',
  CMCSA: 'Comcast',
  MDLZ: 'Mondelez',
  CL: 'Colgate-Palmolive',
  EL: 'Estée Lauder',
  YUM: 'Yum! Brands (KFC)',
  CMG: 'Chipotle',
  LULU: 'Lululemon',
  TJX: 'TJX Companies',
  ROST: 'Ross Stores',
  DG: 'Dollar General',
  KHC: 'Kraft Heinz',
  MO: 'Altria',
  PM: 'Philip Morris',
  XOM: 'Exxon Mobil',
  CVX: 'Chevron เชฟรอน',
  COP: 'ConocoPhillips',
  SLB: 'Schlumberger',
  OXY: 'Occidental Petroleum',
  PSX: 'Phillips 66',
  VLO: 'Valero Energy',
  MPC: 'Marathon Petroleum',
  KMI: 'Kinder Morgan',
  WMB: 'Williams Companies',
  NEE: 'NextEra Energy',
  BA: 'Boeing โบอิ้ง',
  CAT: 'Caterpillar',
  HON: 'Honeywell',
  GE: 'GE Aerospace',
  UPS: 'UPS ยูพีเอส',
  RTX: 'RTX (Raytheon)',
  LMT: 'Lockheed Martin',
  NOC: 'Northrop Grumman',
  DE: 'Deere & Company',
  MMM: '3M',
  UNP: 'Union Pacific',
  FDX: 'FedEx เฟดเอ็กซ์',
  EMR: 'Emerson Electric',
  ETN: 'Eaton',
  GD: 'General Dynamics',
  F: 'Ford ฟอร์ด',
  GM: 'General Motors',
  RIVN: 'Rivian',
  LCID: 'Lucid',
  TM: 'Toyota (ADR ญี่ปุ่น)',
  T: 'AT&T',
  VZ: 'Verizon',
  TMUS: 'T-Mobile US',
  WBD: 'Warner Bros. Discovery',
  AMT: 'American Tower (REIT)',
  PLD: 'Prologis (REIT)',
  O: 'Realty Income (REIT)',
  SPG: 'Simon Property (REIT)',
  SPY: 'SPDR S&P 500 ETF',
  VOO: 'Vanguard S&P 500 ETF',
  VTI: 'Vanguard Total Market ETF',
  QQQ: 'Invesco QQQ (Nasdaq-100)',
  DIA: 'SPDR Dow Jones ETF',
  IWM: 'iShares Russell 2000 ETF',
  SCHD: 'Schwab US Dividend ETF',
  VYM: 'Vanguard High Dividend ETF',
  VIG: 'Vanguard Dividend Appreciation',
  VXUS: 'Vanguard Total Intl ETF',
  VEA: 'Vanguard Developed Markets',
  VWO: 'Vanguard Emerging Markets',
  ARKK: 'ARK Innovation ETF',
  XLK: 'Technology Select SPDR',
  XLF: 'Financial Select SPDR',
  XLE: 'Energy Select SPDR',
  XLV: 'Health Care Select SPDR',
  SOXX: 'iShares Semiconductor ETF',
  SMH: 'VanEck Semiconductor ETF',
  GLD: 'SPDR Gold Shares (ETF ทอง USD)',
  SLV: 'iShares Silver Trust',
  TLT: 'iShares 20+Y Treasury ETF',
  BND: 'Vanguard Total Bond ETF',
  JEPI: 'JPMorgan Equity Premium ETF',
  SCHG: 'Schwab Large-Cap Growth ETF',
  NIO: 'NIO (ADR จีน)',
  BABA: 'Alibaba อาลีบาบา (ADR)',
  SOFI: 'SoFi',
  RBLX: 'Roblox โรบล็อกซ์',
  U: 'Unity Software',
  DOCU: 'DocuSign',
  ZM: 'Zoom',
  PINS: 'Pinterest',
  SNAP: 'Snap สแนป',
  TWLO: 'Twilio',
  EOSE: 'Eos Energy Enterprises',
  OKLO: 'Oklo Inc.',

  // ── ทองคำ ───────────────────────────────────────────────────
  GOLD: 'ทองคำแท่ง (ราคาสมาคมฯ)',
  GOLDORN: 'ทองรูปพรรณ',
};

// คืน type ของ Symbol ถ้ารู้จัก หรือ null ถ้าไม่รู้จัก (ไม่เดามั่ว)
// รับ Symbol แบบ case-insensitive เผื่อ Caller ยังไม่ได้ Normalize
function lookupType(symbol) {
  if (typeof symbol !== 'string') return null;
  return SYMBOL_TYPES[symbol.trim().toUpperCase()] ?? null;
}

// คืนชื่อแสดงผลของ Symbol (null ถ้าไม่รู้จัก/ไม่มีชื่อ) — ไม่ Fallback เป็น Symbol
// ที่นี่ เพื่อให้ Caller แยกได้ว่า "ไม่มีชื่อ" กับ "ชื่อเท่ากับ Symbol พอดี" ต่างกัน
// (listSymbols เป็นตัว Fallback เองเพื่อการแสดงผล)
function lookupName(symbol) {
  if (typeof symbol !== 'string') return null;
  return SYMBOL_NAMES[symbol.trim().toUpperCase()] ?? null;
}

// รายการสินทรัพย์ทั้งหมดที่ระบบรองรับ สำหรับ Dropdown ค้นหาบนเว็บ
//
// วนจาก SYMBOL_TYPES เป็นหลัก (ไม่ใช่ SYMBOL_NAMES) โดยเจตนา — "รองรับหรือไม่"
// ตัดสินที่ SYMBOL_TYPES ที่เดียวเหมือนทุกจุดของระบบ ชื่อเป็นแค่ Metadata ประกอบ
// การแสดงผล ถ้าวนจาก SYMBOL_NAMES แล้วมีใครเผลอเพิ่มชื่อของ Symbol ที่ยังไม่รองรับ
// Dropdown จะโชว์สินทรัพย์ที่บันทึกจริงไม่ได้ (lookupType คืน null → VALIDATION_ERROR)
//
// กองทุนรวมไทย (type 'fund') ไม่อยู่ใน List นี้ตามเจตนา — กองทุนไม่ได้อยู่ใน
// Registry เลย (Resolve ผ่าน SEC API ในเส้นทาง LINE เท่านั้น)
function listSymbols() {
  return Object.keys(SYMBOL_TYPES).map((symbol) => ({
    symbol,
    name: SYMBOL_NAMES[symbol] ?? symbol,
    type: SYMBOL_TYPES[symbol],
  }));
}

module.exports = {
  lookupType,
  lookupName,
  listSymbols,
  SYMBOL_TYPES,
  SYMBOL_NAMES,
};
