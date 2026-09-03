import { describe, expect, it } from "vitest";
import { aspectOf, imageSize } from "../lib/imageSize";

/**
 * الأبعاد تُقرأ من الترويسة — وعليها تُحسب الزاوية.
 *
 * والمعالم كسورٌ من العرض والارتفاع، فنسبة الصورة تدخل الحساب. وقراءةٌ خاطئة هنا
 * لا تُنتج عطلًا ظاهرًا: تُنتج زاويةً تبدو معقولة وهي غلط — وهذا أسوأ.
 */

/** PNG صحيحٌ بترويسة IHDR فقط — لا حاجة إلى بقيّة الملف لقراءة الأبعاد. */
function png(width: number, height: number): Buffer {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "latin1");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([head, ihdr]);
}

/** JPEG بجزءٍ سابقٍ للإطار ثم SOF0 — كما تخرج الصور الحقيقية. */
function jpeg(width: number, height: number, marker = 0xc0): Buffer {
  const parts: number[] = [0xff, 0xd8];
  // جزءٌ لا يحمل أبعادًا (APP0) يسبق الإطار.
  parts.push(0xff, 0xe0, 0x00, 0x10);
  for (let index = 0; index < 14; index += 1) parts.push(0);
  parts.push(0xff, marker, 0x00, 0x11, 0x08);
  parts.push((height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff);
  for (let index = 0; index < 8; index += 1) parts.push(0);
  return Buffer.from(parts);
}

describe("أبعاد الصورة من ترويستها", () => {
  it("PNG", () => {
    expect(imageSize(png(2000, 2500))).toEqual({ width: 2000, height: 2500 });
    expect(imageSize(png(1, 1))).toEqual({ width: 1, height: 1 });
  });

  it("JPEG — وتُقرأ بعد جزءٍ سابقٍ للإطار", () => {
    expect(imageSize(jpeg(1800, 2400))).toEqual({ width: 1800, height: 2400 });
  });

  it("والجداول التي تشبه الإطار لا تُؤخذ إطارًا", () => {
    // 0xC4 جدول هوفمان لا إطار: أخذُه إطارًا يقرأ رقمين من مكانٍ آخر فيُخرج
    // أبعادًا تبدو معقولة وهي غلط — وهذا أخطر من الفشل.
    expect(imageSize(jpeg(1800, 2400, 0xc4))).toBeNull();
    expect(imageSize(jpeg(1800, 2400, 0xc8))).toBeNull();
    expect(imageSize(jpeg(1800, 2400, 0xcc))).toBeNull();
    // وSOF2 (التدريجي) إطارٌ صحيح ويُقرأ.
    expect(imageSize(jpeg(1800, 2400, 0xc2))).toEqual({ width: 1800, height: 2400 });
  });

  it("وما لا يُقرأ يردّ فراغًا لا يرمي", () => {
    expect(imageSize(Buffer.alloc(0))).toBeNull();
    expect(imageSize(Buffer.from("%PDF-1.7\n"))).toBeNull();
    expect(imageSize(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(imageSize(Buffer.from("RIFFxxxxWEBPXXXX"))).toBeNull();
    // ترويسةٌ مبتورة في منتصف IHDR.
    expect(imageSize(png(100, 100).subarray(0, 18))).toBeNull();
  });

  it("وأبعادٌ صفرية تُردّ — قسمةٌ على صفرٍ لا تُنتج نسبة", () => {
    expect(imageSize(png(0, 100))).toBeNull();
    expect(imageSize(png(100, 0))).toBeNull();
  });
});

describe("النسبة", () => {
  it("العرض على الارتفاع — نفس ما ترسله الشاشة", () => {
    expect(aspectOf({ width: 2000, height: 2500 })).toBeCloseTo(0.8, 10);
    expect(aspectOf({ width: 320, height: 320 })).toBe(1);
  });

  it("والغياب يعني واحدًا — السلوك القديم يبقى لمن لا أبعادَ له", () => {
    // لا تتغيّر أرقامٌ لا نملك ما يصحّحها.
    expect(aspectOf(null)).toBe(1);
    expect(aspectOf({ width: null, height: 2500 })).toBe(1);
    expect(aspectOf({ width: 2000, height: null })).toBe(1);
    expect(aspectOf({ width: 0, height: 0 })).toBe(1);
    expect(aspectOf({ width: -5, height: 10 })).toBe(1);
  });
});
