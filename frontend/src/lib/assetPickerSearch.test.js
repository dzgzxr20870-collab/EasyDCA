import { describe, test, expect } from 'vitest';
import { normalize, matchesCategory, filterSymbols } from './assetPickerSearch.js';

const SYMBOLS = [
  { symbol: 'AMD', name: 'Advanced Micro Devices เอเอ็มดี', type: 'stock_us' },
  { symbol: 'PTT', name: 'ปตท.', type: 'stock_th' },
  { symbol: 'BTC', name: 'Bitcoin บิตคอยน์', type: 'crypto' },
  { symbol: 'GOLD', name: 'ทองคำแท่ง (ราคาสมาคมฯ)', type: 'gold_bar' },
  { symbol: 'GOLDORN', name: 'ทองรูปพรรณ', type: 'gold_ornament' },
];

describe('normalize', () => {
  test('ตัวพิมพ์เล็ก + ตัดช่องว่างทั้งหมด', () => {
    expect(normalize('  A M D  ')).toBe('amd');
    expect(normalize('PTT')).toBe('ptt');
  });

  test('ค่าว่าง/undefined → สตริงว่าง (ไม่ throw)', () => {
    expect(normalize(undefined)).toBe('');
    expect(normalize(null)).toBe('');
  });
});

describe('matchesCategory', () => {
  test("'all' ผ่านทุก Type", () => {
    expect(matchesCategory('stock_th', 'all')).toBe(true);
    expect(matchesCategory('crypto', 'all')).toBe(true);
  });

  test("'gold' ครอบคลุมทั้ง gold_bar และ gold_ornament", () => {
    expect(matchesCategory('gold_bar', 'gold')).toBe(true);
    expect(matchesCategory('gold_ornament', 'gold')).toBe(true);
    expect(matchesCategory('crypto', 'gold')).toBe(false);
  });

  test('Type อื่น Match ตรงตัวเท่านั้น', () => {
    expect(matchesCategory('stock_us', 'stock_us')).toBe(true);
    expect(matchesCategory('stock_th', 'stock_us')).toBe(false);
  });
});

describe('filterSymbols', () => {
  test('ค้นหา "AMD" เจอ AMD', () => {
    const result = filterSymbols(SYMBOLS, { query: 'AMD' });
    expect(result.map((s) => s.symbol)).toEqual(['AMD']);
  });

  test('ค้นหา "ปตท" เจอ PTT (ค้นชื่อไทยได้)', () => {
    const result = filterSymbols(SYMBOLS, { query: 'ปตท' });
    expect(result.map((s) => s.symbol)).toEqual(['PTT']);
  });

  test('ค้นหา "PTT" (Symbol ตรงตัว) เจอ PTT', () => {
    const result = filterSymbols(SYMBOLS, { query: 'PTT' });
    expect(result.map((s) => s.symbol)).toEqual(['PTT']);
  });

  test('ค้นหาตัวพิมพ์เล็ก/มีช่องว่างปน ยังเจอเหมือนกัน', () => {
    expect(filterSymbols(SYMBOLS, { query: 'a m d' }).map((s) => s.symbol)).toEqual(['AMD']);
    expect(filterSymbols(SYMBOLS, { query: 'amd' }).map((s) => s.symbol)).toEqual(['AMD']);
  });

  test('กรองตามหมวด "gold" ได้ทั้ง GOLD และ GOLDORN', () => {
    const result = filterSymbols(SYMBOLS, { category: 'gold' });
    expect(result.map((s) => s.symbol).sort()).toEqual(['GOLD', 'GOLDORN']);
  });

  test('ไม่มีคำค้น (query ว่าง) → คืนทั้งหมดในหมวดนั้น', () => {
    const result = filterSymbols(SYMBOLS, { category: 'stock_th', query: '' });
    expect(result.map((s) => s.symbol)).toEqual(['PTT']);
  });

  test('ไม่พบผลลัพธ์ → คืน Array ว่าง', () => {
    expect(filterSymbols(SYMBOLS, { query: 'ไม่มีจริง' })).toEqual([]);
  });

  test('symbols เป็น null/undefined → คืน Array ว่าง (ไม่ throw)', () => {
    expect(filterSymbols(null, { query: 'AMD' })).toEqual([]);
    expect(filterSymbols(undefined)).toEqual([]);
  });
});
