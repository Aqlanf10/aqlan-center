/**
 * أبعاد الصورة من ترويستها — بلا مكتبة.
 *
 * ### لماذا هذا الملف موجود أصلًا
 *
 * معالم التتبّع تُحفظ **كسورًا** من العرض والارتفاع، لا بالبكسل. وهذا صحيح: الصورة
 * نفسها تُعرض بأحجامٍ مختلفة على شاشاتٍ مختلفة، والكسر لا يتغيّر. لكنه يعني أن
 * **نسبة الصورة تدخل حساب الزاوية**: نقطتان تفصل بينهما ٠٫١ أفقيًّا و٠٫١ رأسيًّا
 * تصنعان ٤٥° على صورةٍ مربّعة، وزاويةً أخرى على صورةٍ نسبتها ٤:٥.
 *
 * وشاشةُ التتبّع تعرف النسبة — المتصفّح حمّل الصورة فقاس أبعادها. **أمّا الخادم
 * فلم يكن يعرفها**، فكان تقرير الطباعة يحسب على نسبة ١. والفارق ليس تجميليًّا:
 * على أشعّةٍ ٤:٥ تُقاس FMA ‏٣٦٫٠° على الشاشة و‏٢٩٫٤° على الورقة — وستّ درجاتٍ
 * ونصف هي الفرق بين نمطٍ عمودي مرتفع ونمطٍ سويّ، وعليها يُقرَّر القلع والتثبيت.
 *
 * فصارت الأبعاد تُقرأ من الملف نفسه وتُحفظ مع وصفه. والقراءة من الترويسة لا
 * بمكتبة: عشرون بايتًا تكفي، وإضافةُ اعتمادية لفكّ صورةٍ كاملة في الذاكرة من أجل
 * رقمين هو ما يجعل النشر بطيئًا والصورة ثقيلة.
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** PNG: العرض والارتفاع في كتلة `IHDR` — أوّل كتلةٍ دائمًا. */
function pngSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 24) return null;
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (bytes.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * JPEG: تُمشى الأجزاء حتى `SOFn` — وهو الوحيد الذي يحمل الأبعاد.
 *
 * و`SOF4` (`0xC4`) و`SOF8` (`0xC8`) و`SOFC` (`0xCC`) ليست إطارات: هي جداول
 * هوفمان والامتدادات والحسابي. وأخذُها على أنها إطار يقرأ رقمين من مكانٍ آخر
 * فيُخرج أبعادًا تبدو معقولة وهي غلط.
 */
function jpegSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    // حشوٌ من 0xFF، أو علاماتٌ بلا حمولة.
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
    const length = bytes.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** WebP بصيغه الثلاث — `VP8 ` المضغوطة و`VP8L` بلا فقد و`VP8X` الممتدّة. */
function webpSize(bytes: Buffer): ImageSize | null {
  if (bytes.length < 30) return null;
  if (bytes.subarray(0, 4).toString("latin1") !== "RIFF") return null;
  if (bytes.subarray(8, 12).toString("latin1") !== "WEBP") return null;
  const kind = bytes.subarray(12, 16).toString("latin1");
  if (kind === "VP8 ") {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (kind === "VP8L") {
    const packed = bytes.readUInt32LE(21);
    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") {
    const read24 = (at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    return { width: read24(24) + 1, height: read24(27) + 1 };
  }
  return null;
}

/**
 * أبعاد الصورة، أو `null` لما لا يُقرأ.
 *
 * و`null` ليست عطلًا: مستندٌ PDF لا أبعادَ صورةٍ له، وصورةٌ بصيغةٍ لا نقرؤها
 * تبقى بلا أبعاد فيُحسب عليها كما كان. والرفضُ هنا كان سيمنع رفع مستندٍ سليم.
 */
export function imageSize(bytes: Buffer): ImageSize | null {
  const size = pngSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes);
  if (!size) return null;
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height)) return null;
  if (size.width <= 0 || size.height <= 0) return null;
  return size;
}

/**
 * النسبة التي يدخل بها العرض في حساب الزاوية.
 *
 * وهي `العرض ÷ الارتفاع` — نفس ما ترسله الشاشة من `naturalWidth / naturalHeight`.
 * والغياب يعني ١، وهو ما كان يُحسب به دائمًا: فالسلوك القديم يبقى لمن لا أبعادَ
 * له، ولا تتغيّر أرقامٌ لا نملك ما يصحّحها.
 */
export function aspectOf(size: { width: number | null; height: number | null } | null): number {
  if (!size || !size.width || !size.height) return 1;
  if (size.width <= 0 || size.height <= 0) return 1;
  return size.width / size.height;
}
