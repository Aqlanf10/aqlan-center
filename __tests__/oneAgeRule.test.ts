import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * حارسٌ على المصدر نفسه: قاعدةٌ واحدة للعمر، مكتوبةٌ مرّةً واحدة.
 *
 * وحارسُ سلوكٍ وحده لا يمنع أحدًا من كتابة نسخةٍ ثانية غدًا تتّفق مع الأولى
 * اليوم وتفترق عنها بعد شهر. فالفحص هنا على الكود لا على مخرجاته.
 */
const LIB = join(process.cwd(), "lib");

const sources = readdirSync(LIB)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, text: readFileSync(join(LIB, name), "utf8") }));

describe("قاعدة العمر مكتوبةٌ مرّةً واحدة", () => {
  it("ولا تُعرَّف إلّا في lib/patient.ts", () => {
    const definers = sources
      .filter((file) => /export function ageFromBirthYear\b/.test(file.text))
      .map((file) => file.name);
    expect(definers).toEqual(["patient.ts"]);
  });

  it("ولا يُطرح فيها عامٌ من عامٍ بيدٍ خارجها", () => {
    /*
     * `Number(date.slice(0, 4)) - birthYear` هو الحساب الثاني بعينه — كُتب في
     * ورقة التحليل مرّةً فقبل سنة ميلادٍ بعد تاريخ الأشعّة وطبع عمرًا سالبًا.
     */
    const roots = ["lib", "app", "components"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const text = readFileSync(path, "utf8");
        if (/-\s*(patient\.)?birthYear\b/.test(text) && !path.endsWith("lib/patient.ts")) {
          offenders.push(path.replace(process.cwd(), ""));
        }
      }
    };
    for (const root of roots) walk(join(process.cwd(), root));
    expect(offenders, offenders.join(" · ")).toEqual([]);
  });
});
