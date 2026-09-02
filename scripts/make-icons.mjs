#!/usr/bin/env node
/**
 * توليد أيقونات التثبيت من `app/icon.svg` — مصدرٌ واحد للشكل.
 *
 * أندرويد يطلب PNG بمقاسين ولا يقبل SVG في كل الحالات، فلو رُسمت الأيقونات يدويًا
 * لانحرفت عن الشعار عند أول تعديل. هذا السكربت يرسمها من الملف نفسه بمتصفّحٍ
 * حقيقي، فتبقى واحدة. يُشغَّل عند تغيير الشعار وحده — والمخرجات محفوظة في المخزن.
 *
 *   node scripts/make-icons.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadChromium, executablePath } from "./journeys/playwright.mjs";

const root = new URL("../", import.meta.url);
const svg = await readFile(fileURLToPath(new URL("app/icon.svg", root)), "utf8");

/**
 * الأيقونة العادية تُعرض كما هي بقرصها الكحلي.
 * و«القابلة للقصّ» تُرسم بخلفيةٍ ممتدّة والشعارُ في وسطها بلا قرصه — لأن أندرويد
 * يقصّها دائرةً، فما خرج عن الدائرة الآمنة يُقطع. بلا هذا تُقصّ أطراف السنّة.
 */
const page = (size, maskable) => `<!doctype html><html><body style="margin:0">
<div style="width:${size}px;height:${size}px;background:${maskable ? "#0d2137" : "transparent"};
     display:flex;align-items:center;justify-content:center;overflow:hidden">
  <div style="width:${Math.round(size * (maskable ? 0.95 : 1))}px;
       height:${Math.round(size * (maskable ? 0.95 : 1))}px">${
         maskable ? svg.replace(/<rect width="48" height="48"[^>]*\/>/, "") : svg
       }</div>
</div></body></html>`;

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath });

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

for (const target of targets) {
  const context = await browser.newContext({
    viewport: { width: target.size, height: target.size },
    deviceScaleFactor: 1,
  });
  const tab = await context.newPage();
  await tab.setContent(page(target.size, target.maskable));
  const png = await tab.screenshot({ omitBackground: !target.maskable });
  await writeFile(fileURLToPath(new URL(`public/icons/${target.file}`, root)), png);
  console.log(`✓ ${target.file} — ${target.size}×${target.size} — ${png.length} بايت`);
  await context.close();
}

await browser.close();
