import { deflateSync } from "node:zlib";

/**
 * يصنع صورة PNG صالحة بالمقاس المطلوب — بلا تبعية ولا ملفٍّ ثابت.
 *
 * ولماذا تُصنع لا تُخزَّن base64 في السكربت: الرحلة تحتاج **مقاسًا بعينه** —
 * ومربّعةٌ تختلف عن مستطيلة في حساب الزوايا. وسلسلةٌ مشفَّرة في الملف لا يُعرف
 * مقاسها بالنظر، فتُقرأ الرحلة ولا يُفهم لماذا خرجت الأرقام كما خرجت.
 */
export function makePng(width = 320, height = 320) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset++] = 0; // مرشّح السطر: بلا
    for (let x = 0; x < width; x += 1) {
      const value = 40 + ((x + y) % 60); // تدرّج خفيف ليُرى أنها صورة لا فراغ
      raw[offset++] = value; raw[offset++] = value; raw[offset++] = value;
    }
  }

  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;   // ثماني بتّات للقناة
  header[9] = 2;   // RGB بلا شفافية
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
