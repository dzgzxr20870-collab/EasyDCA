#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// CI Check — Migration Filename Numbering (S6+ CI Setup)
// ═══════════════════════════════════════════════════════════════════════
// ตรวจว่าทุกไฟล์ .sql ใน backend/migrations/ มีเลขนำหน้าไม่ซ้ำกัน และมีความยาว
// Zero-padding เท่ากันทุกไฟล์ (เช่น "001", "016" — ไม่ใช่ "1", "16" ปนกัน) —
// จับกรณี 2 คน/2 Session สร้าง Migration เลขเดียวกันโดยไม่รู้ตัว (ไฟล์หนึ่งจะ
// "บัง" อีกไฟล์แบบเงียบๆ ถ้าปล่อยเลขซ้ำไว้) หรือความยาว Digit ไม่เท่ากันทำให้
// เรียงลำดับตามชื่อไฟล์ผิดเพี้ยน (เช่น "9_x.sql" มาหลัง "10_y.sql" ตาม
// Alphabetical Sort)
//
// ⚠️ Scope ตั้งใจแคบ: ตรวจแค่ "ชื่อไฟล์ไม่ชนกัน" เท่านั้น "ไม่ได้" ตรวจว่าเนื้อหา
// SQL ข้างในถูกต้อง/รันได้จริงหรือไม่ — migrations 001-015 เป็น Delta ที่พึ่งพา
// Baseline Schema (users/portfolios/assets/transactions ฯลฯ + ฟังก์ชัน
// update_updated_at()) ที่ถูกสร้างตรงผ่าน Supabase SQL Editor มาก่อน ไม่เคยถูก
// Capture เป็น Migration File เลย จึงไม่มีทางรัน Migration ไล่ตั้งแต่ต้นบน Postgres
// เปล่าได้จริงโดยไม่สร้าง Baseline ปลอมขึ้นมาก่อน (ความเสี่ยงที่จะให้ผลลัพธ์เข้าใจผิด
// มากกว่าไม่ตรวจเลย — ดู docs/DEPLOYMENT.md § 5.1 สำหรับรายละเอียดเหตุผล)

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'backend', 'migrations');

function main() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.error(`✗ ไม่พบไฟล์ .sql ใดเลยใน ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const seenPrefixes = new Map(); // prefix (String ตามที่เจอในชื่อไฟล์) → filename
  const digitLengths = new Set();
  let hasError = false;

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match) {
      console.error(`✗ ${file}: ชื่อไฟล์ต้องขึ้นต้นด้วยเลข Migration + "_" (เช่น 016_add_x.sql)`);
      hasError = true;
      continue;
    }

    const prefix = match[1];
    digitLengths.add(prefix.length);

    if (seenPrefixes.has(prefix)) {
      console.error(
        `✗ เลข Migration ซ้ำกัน (${prefix}): "${seenPrefixes.get(prefix)}" กับ "${file}" — ` +
          'ไฟล์หนึ่งจะบังอีกไฟล์แบบเงียบๆ ถ้าปล่อยไว้ ต้องเปลี่ยนเลขให้ไม่ซ้ำก่อน Merge'
      );
      hasError = true;
    } else {
      seenPrefixes.set(prefix, file);
    }
  }

  if (digitLengths.size > 1) {
    console.error(
      `✗ ความยาวเลขนำหน้าไม่เท่ากันในทุกไฟล์ (พบ ${[...digitLengths].sort().join(', ')} หลัก) — ` +
        'ใช้ Zero-padding ความยาวเดียวกันทุกไฟล์ (เช่น 3 หลัก: 001, 016)'
    );
    hasError = true;
  }

  if (hasError) {
    console.error(`\n✗ Migration numbering check ล้มเหลว (${files.length} ไฟล์ที่ตรวจ)`);
    process.exit(1);
  }

  const sortedNumbers = [...seenPrefixes.keys()].sort((a, b) => Number(a) - Number(b));
  console.log(
    `✓ Migration numbering OK — ${files.length} ไฟล์ เลขนำหน้าไม่ซ้ำกันทั้งหมด ` +
      `(${sortedNumbers[0]}–${sortedNumbers[sortedNumbers.length - 1]})`
  );
}

main();
