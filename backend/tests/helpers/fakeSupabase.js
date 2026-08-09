// ═══════════════════════════════════════════════════════════════════════════
// Fake Supabase Client (In-memory) ที่ "บังคับ Filter ตามจริง"
// ═══════════════════════════════════════════════════════════════════════════
// สร้างขึ้นสำหรับ Cross-User Isolation Regression Test (Security Audit 9 ส.ค. 2026)
//
// ต่างจาก Mock ทั่วไปในโปรเจกต์นี้ (ที่ jest.mock ทั้ง Repository แล้วกำหนดค่าคืนเอง)
// ตัวนี้ Implement Semantics ของ PostgREST ตามจริง: ทุก .eq()/.gt()/.lt()/.neq()
// ถูกนำไปกรองแถวจริงในหน่วยความจำ — จุดประสงค์คือให้ Repository "ตัวจริง" รันทับ
// มันได้ เพื่อพิสูจน์ว่า Query กรอง user_id จริง ไม่ใช่แค่ "ส่ง userId ลงไป"
//
// ⚠️ ถ้า Query ไหนลืม `.eq('user_id', userId)` Fake ตัวนี้จะคืนแถวของผู้ใช้คนอื่น
// ออกมาตามความจริงของ PostgREST → เทสต์แดงทันที นี่คือคุณสมบัติที่ต้องรักษาไว้
// ห้ามแก้ Fake ให้ "ยอมผ่าน" เพื่อให้เทสต์เขียว
//
// รองรับเท่าที่ Repository ในโปรเจกต์ใช้จริง (ไม่ทำเกินความจำเป็น):
//   from / select / insert / update / delete / eq / neq / gt / lt / in / order /
//   single / maybeSingle + await ตัว Builder ตรงๆ (Thenable)

const tables = {};

function resetTables(initial = {}) {
  for (const key of Object.keys(tables)) delete tables[key];
  for (const [name, rows] of Object.entries(initial)) tables[name] = [...rows];
}

function table(name) {
  if (!tables[name]) tables[name] = [];
  return tables[name];
}

class FakeQuery {
  constructor(tableName) {
    this.tableName = tableName;
    this.op = 'select';
    this.filters = [];
    this.patch = null;
    this.insertRow = null;
    this.shape = 'many'; // 'many' | 'single' | 'maybeSingle'
  }

  select() {
    return this;
  }

  insert(row) {
    this.op = 'insert';
    this.insertRow = row;
    return this;
  }

  update(patch) {
    this.op = 'update';
    this.patch = patch;
    return this;
  }

  delete() {
    this.op = 'delete';
    return this;
  }

  eq(col, val) {
    this.filters.push((r) => r[col] === val);
    return this;
  }

  neq(col, val) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }

  gt(col, val) {
    this.filters.push((r) => r[col] > val);
    return this;
  }

  lt(col, val) {
    this.filters.push((r) => r[col] < val);
    return this;
  }

  in(col, values) {
    const set = new Set(values);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }

  order() {
    return this;
  }

  limit(n) {
    this.limitN = n;
    return this;
  }

  single() {
    this.shape = 'single';
    return this;
  }

  maybeSingle() {
    this.shape = 'maybeSingle';
    return this;
  }

  run() {
    const rows = table(this.tableName);

    if (this.op === 'insert') {
      const row = { id: `row-${rows.length + 1}`, ...this.insertRow };
      rows.push(row);
      return [row];
    }

    let matched = rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.op === 'select' && typeof this.limitN === 'number') {
      matched = matched.slice(0, this.limitN);
    }

    if (this.op === 'update') {
      for (const row of matched) Object.assign(row, this.patch);
      return matched;
    }

    if (this.op === 'delete') {
      tables[this.tableName] = rows.filter((r) => !matched.includes(r));
      return matched;
    }

    return matched;
  }

  // Thenable — Repository บางจุด await ตัว Builder ตรงๆ โดยไม่ปิดท้ายด้วย
  // single()/maybeSingle() (เช่น findByBatchIdForUser / expireOverdue)
  //
  // PostgREST: .single() ที่ไม่ได้ 1 แถวพอดี = Error, .maybeSingle() = คืน null
  then(resolve, reject) {
    let result;

    try {
      const rows = this.run();

      if (this.shape === 'single') {
        result =
          rows.length === 1
            ? { data: rows[0], error: null }
            : {
                data: null,
                error: { message: 'JSON object requested, multiple (or no) rows returned' },
              };
      } else if (this.shape === 'maybeSingle') {
        result = { data: rows[0] ?? null, error: null };
      } else {
        result = { data: rows, error: null };
      }
    } catch (err) {
      return reject(err);
    }

    return resolve(result);
  }
}

// from() ห่อด้วย jest.fn() ให้ Test เรียก .toHaveBeenCalled()/.toHaveBeenCalledWith()
// ตรวจ "ไม่มีการยิง Query เลย" ได้ (เช่น กรณี Guard throw ก่อนถึง .from()) — พฤติกรรม
// เดิมไม่เปลี่ยน (ยัง new FakeQuery(tableName) เหมือนเดิมทุกประการ แค่ Spy ได้เพิ่ม)
function createClient() {
  return { from: jest.fn((tableName) => new FakeQuery(tableName)) };
}

module.exports = { createClient, tables, resetTables, table };
