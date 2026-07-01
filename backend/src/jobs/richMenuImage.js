// สร้างรูปภาพ Rich Menu แบบ Placeholder (สีพื้นแบ่ง 5 ช่อง + Label ตัวอักษร)
// ⚠️ PLACEHOLDER — รอ Design จริงจากทีม Design ตาม UI_UX.md § 1 มาแทนที่
// ก่อนใช้งานจริงกับผู้ใช้
//
// ไม่ใช้ Library ภายนอก (เช่น canvas/sharp) เพราะต้อง Compile Native
// Binding ซึ่งเสี่ยงใช้ไม่ได้บน Windows/Node เวอร์ชันใหม่ — เขียน PNG
// Encoder เองด้วย zlib (Built-in ของ Node) แทน
//
// ข้อจำกัด: วาด Label เป็นตัวอักษรอังกฤษด้วย Bitmap Font 5x7 ที่เขียนเอง
// (ไม่ใช่ Font จริงจาก UI_UX.md § 1.2 อย่าง Noto Sans Thai) เพราะการ Render
// ตัวอักษรไทย (สระ/วรรณยุกต์ซ้อนกัน) ด้วย Pixel Font เองมีความซับซ้อนเกินไป
// สำหรับ Placeholder — เมื่อมีรูปจริงจาก Design แล้วให้ลบไฟล์นี้และ Endpoint
// อัพโหลดรูปคงที่แทน
const zlib = require('zlib');

const WIDTH = 2500;
const HEIGHT = 843;
const SECTION_COUNT = 5;
const SECTION_WIDTH = WIDTH / SECTION_COUNT;

const BG_COLOR = [15, 61, 104]; // UI_UX.md § 1.1 Primary (Navy Blue) #0F3D68
const LINE_COLOR = [255, 255, 255];

// Bitmap Font 5x7 ที่ออกแบบเอง (ไม่ใช่ Font มาตรฐาน) — ครอบคลุมเฉพาะตัวอักษร
// ที่ใช้ใน Label ของปุ่ม Rich Menu เท่านั้น
const FONT_5X7 = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const GLYPH_GAP = 1;

// Label ภาษาอังกฤษของแต่ละปุ่ม (เรียงตรงกับ areas ใน setupRichMenu.js)
const LABELS = ['ADD', 'PORTFOLIO', 'HISTORY', 'PREMIUM', 'SETTINGS'];

function setPixel(raw, x, y, color) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const rowStart = y * (1 + WIDTH * 3);
  const offset = rowStart + 1 + x * 3;
  raw[offset] = color[0];
  raw[offset + 1] = color[1];
  raw[offset + 2] = color[2];
}

function fillRect(raw, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      setPixel(raw, x, y, color);
    }
  }
}

function drawLabel(raw, sectionIndex, word) {
  const unitsWide = word.length * GLYPH_W + (word.length - 1) * GLYPH_GAP;
  const maxWidthPx = SECTION_WIDTH - 60;
  const maxHeightPx = 200;

  const scale = Math.max(
    1,
    Math.min(Math.floor(maxWidthPx / unitsWide), Math.floor(maxHeightPx / GLYPH_H), 40)
  );

  const textWidthPx = unitsWide * scale;
  const textHeightPx = GLYPH_H * scale;
  const sectionX0 = sectionIndex * SECTION_WIDTH;
  const startX = sectionX0 + Math.floor((SECTION_WIDTH - textWidthPx) / 2);
  const startY = Math.floor((HEIGHT - textHeightPx) / 2);

  let cursorX = startX;
  for (const ch of word) {
    const glyph = FONT_5X7[ch] ?? FONT_5X7[' '];
    for (let row = 0; row < GLYPH_H; row++) {
      const bits = glyph[row];
      for (let col = 0; col < GLYPH_W; col++) {
        if (bits[col] === '#') {
          fillRect(raw, cursorX + col * scale, startY + row * scale, scale, scale, LINE_COLOR);
        }
      }
    }
    cursorX += (GLYPH_W + GLYPH_GAP) * scale;
  }
}

// ── PNG Encoder แบบ Minimal (Uncompressed Filter + zlib deflate) ─────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

function encodePng(raw) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(WIDTH, 0);
  ihdrData.writeUInt32BE(HEIGHT, 4);
  ihdrData.writeUInt8(8, 8); // bit depth
  ihdrData.writeUInt8(2, 9); // color type: RGB
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace

  const idatData = zlib.deflateSync(raw);
  const iendData = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', iendData),
  ]);
}

// สร้างรูป Rich Menu Placeholder ขนาด 2500x843 (LINE Spec เต็มความกว้าง
// แถวเดียว) แบ่ง 5 ช่องเท่ากัน พร้อม Label ภาษาอังกฤษกลางช่อง
function generatePlaceholderImage() {
  const bytesPerRow = 1 + WIDTH * 3; // filter byte + RGB
  const raw = Buffer.alloc(bytesPerRow * HEIGHT);

  fillRect(raw, 0, 0, WIDTH, HEIGHT, BG_COLOR);

  // เส้นแบ่งช่อง (2px) ที่ขอบขวาของช่องที่ 1-4
  for (let i = 1; i < SECTION_COUNT; i++) {
    fillRect(raw, i * SECTION_WIDTH - 1, 0, 2, HEIGHT, LINE_COLOR);
  }

  LABELS.forEach((label, index) => drawLabel(raw, index, label));

  return encodePng(raw);
}

module.exports = {
  generatePlaceholderImage,
  WIDTH,
  HEIGHT,
};
