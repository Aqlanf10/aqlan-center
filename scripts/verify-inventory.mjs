#!/usr/bin/env node
import { pgConnection } from "../lib/pgConnection.ts";
import "./load-env.mjs";
import { Client } from "pg";

/**
 * هل المخزون سجلٌّ يُعتمد عليه؟
 *
 * والأسئلة التي تقرّر ذلك كلها عن حال القاعدة، فلا يجيب عنها اختبار وحدة:
 *
 * ١) هل يُصرف ما لا يوجد حين يضغط موظفان في اللحظة نفسها؟ هذا هو الخطر كلّه:
 *    كلاهما يقرأ رصيدًا يكفيه، فيخرج الرصيد سالبًا وقد صُرف ما ليس في المخزن.
 * ٢) هل يبقى الرصيد المشتقّ موافقًا لحركاته بعد كل عملية؟ رقمٌ يفارق سجلّه لا
 *    يُعرف أيّهما الصحيح.
 * ٣) هل تُمنع التسوية بلا سبب؟ هي البابُ الوحيد الذي يُغيّر الرصيد بلا مستند.
 * ٤) هل يُمنع بندان بالاسم نفسه؟ اسمان لبندٍ واحد يقسمان رصيدًا فيبدو كلاهما
 *    تحت الحدّ والمخزن ممتلئ.
 * ٥) هل تتفق «أقرب صلاحية باقية» المحسوبة في القاعدة مع نظيرتها في التطبيق؟
 *    نسختان لقاعدةٍ واحدة تفترقان بصمت، فتُنبِّه الشاشة على دفعةٍ صُرفت — ومن
 *    يتجاوز تنبيهًا كاذبًا مرّتين يتجاوز الصادق في الثالثة.
 */

const source = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
if (!source.trim()) { console.error("خطأ: SOURCE_DATABASE_URL غير مضبوط."); process.exit(1); }

const withDatabase = (url, name) => {
  const parsed = new URL(url); parsed.pathname = `/${name}`; return parsed.toString();
};

const temporary = `inventory_check_${Date.now()}`;
process.env.DATABASE_URL = withDatabase(source, temporary);
const admin = new Client(pgConnection(source));
let failed = false;
const check = (label, ok, extra = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed = true;
};

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${temporary}`);
  const db = await import("../lib/db.ts");
  await db.ensureSchema();

  console.log("\n  ── البند ورصيده ──");

  const created = await db.createInventoryItem({
    name: "قفازات نتريل مقاس M", category: "consumable", unit: "علبة",
    minLevel: 5, note: null, actor: "فحص",
  });
  check("أُنشئ البند", created.ok, created.ok ? `رقم ${created.id}` : created.message);
  const itemId = created.id;

  const twin = await db.createInventoryItem({
    name: "  قفازات نتريل مقاس m  ", category: "consumable", unit: "علبة",
    minLevel: 5, note: null, actor: "فحص",
  });
  check("وبندٌ ثانٍ بالاسم نفسه مرفوض", !twin.ok, twin.message ?? "");

  await db.recordMovement({
    itemId, kind: "in", qty: 10, expiryDate: "2027-01-01",
    reason: "شراء", visitId: null, patientId: null, actor: "فحص",
  });
  await db.recordMovement({
    itemId, kind: "out", qty: 3, expiryDate: null,
    reason: null, visitId: null, patientId: null, actor: "فحص",
  });

  const afterTwo = (await db.listInventory()).find((item) => item.id === itemId);
  check("الرصيد مشتقٌّ من الحركات", afterTwo.balance === 7, `${afterTwo.balance}`);
  check("ويوافق ما تحسبه الحركات نفسها",
    (await db.inventoryBalance(itemId)) === afterTwo.balance);
  check("وحالته «متوفّر» فوق الحدّ", afterTwo.status === "ok", afterTwo.status);

  await db.recordMovement({
    itemId, kind: "out", qty: 4, expiryDate: null,
    reason: null, visitId: null, patientId: null, actor: "فحص",
  });
  const low = (await db.listInventory()).find((item) => item.id === itemId);
  check("ودون الحدّ يُنبَّه قبل الانتهاء لا بعده", low.status === "low", `${low.balance} < ${low.minLevel}`);

  console.log("\n  ── لا يُصرف ما لا يوجد ──");

  const over = await db.recordMovement({
    itemId, kind: "out", qty: 99, expiryDate: null,
    reason: null, visitId: null, patientId: null, actor: "فحص",
  });
  check("صرفٌ فوق الرصيد مرفوض", !over.ok, over.message ?? "");
  check("ولم تُكتب حركةٌ يتيمة", (await db.inventoryBalance(itemId)) === 3);

  /*
   * وهذا هو الفحص الذي بُني القفل له — وصيغتان منه كذبتا قبل أن يصدق.
   *
   * **الأولى**: عشر محاولاتٍ متزامنة وشرطُ أن تنجح واحدة. مرّت بلا القفل أيضًا،
   * لأن التزامن في Node ليس مضمونًا. وحين طُبع ما تقرؤه كلٌّ منها ظهر الفرق:
   * محاولتان قرأتا الرصيد ٣ معًا فنجحتا ونزل الرصيد إلى ‎-1‎.
   *
   * **والثانية**: يُقفل الصفّ من الخارج ويُشترط أن ينتظر الصرف. ومرّت بلا القفل
   * كذلك — لأن إدراج الحركة يأخذ قفلًا ضمنيًّا على صفّ البند بحكم المفتاح
   * الأجنبي، فينتظر على أيّ حال. أي أنها كانت تفحص قفل المفتاح لا قفلنا،
   * **وقفل المفتاح يأتي بعد الفحص فلا يمنع قراءةً قديمة**.
   *
   * **والثالثة تفحص الآلية نفسها**: يُقفل الصفّ من الخارج، ثم يُطلب صرفٌ فيتعطّل،
   * ثم **يتغيّر الرصيد** قبل الإفراج. فإن كان الصرف يقرأ الرصيد **بعد** القفل رأى
   * التغيّر ورفض؛ وإن كان قرأه قبله بنى على رقمٍ بطَل — وهذا هو العطل بعينه.
   */
  console.log("\n  ── القفل يُقرأ بعده لا قبله ──");

  // رصيدٌ يكفي صرفًا واحدًا فقط.
  await db.recordMovement({
    itemId, kind: "in", qty: 2, expiryDate: null,
    reason: null, visitId: null, patientId: null, actor: "فحص",
  });
  const startBalance = await db.inventoryBalance(itemId);

  const holder = new Client(pgConnection(process.env.DATABASE_URL));
  await holder.connect();
  await holder.query("BEGIN");
  await holder.query(`SELECT id FROM inventory_items WHERE id = $1 FOR UPDATE`, [itemId]);

  // يُطلب الصرف وهو مقفول — فيتعطّل عند القفل إن كان يقفل.
  const contender = db.recordMovement({
    itemId, kind: "out", qty: startBalance, expiryDate: null,
    reason: null, visitId: null, patientId: null, actor: "فحص",
  }).catch(() => ({ ok: false, message: "استثناء" }));
  await new Promise((resolve) => setTimeout(resolve, 600));

  // ثم يُستهلك الرصيد إلا واحدًا من داخل المعاملة القافلة، ويُفرَج. والواحد الباقي
  // مقصود: يُثبت أن الرفض جاء من **قراءةٍ بعد القفل** لا من رصيدٍ صار صفرًا.
  await holder.query(
    `INSERT INTO inventory_movements (item_id, kind, qty, created_by)
     VALUES ($1, 'out', $2, 'فحص')`, [itemId, startBalance - 1]);
  await holder.query("COMMIT");
  await holder.end();

  const result = await contender;
  check("الصرف يرى ما تغيّر تحت القفل فيرفض", !result.ok,
    result.ok ? "قرأ رصيدًا بطَل ومضى — لا قفل" : result.message);
  const afterRace = await db.inventoryBalance(itemId);
  check("والرصيد لم ينزل تحت الصفر", afterRace === 1, `${afterRace}`);

  console.log("\n  ── التسوية بابٌ موثَّق لا مفتوح ──");

  const bare = await db.recordMovement({
    itemId, kind: "adjust", qty: -1, expiryDate: null,
    reason: null, visitId: null, patientId: null, actor: "فحص",
  });
  check("تسويةٌ بلا سبب مرفوضة", !bare.ok, bare.message ?? "");

  const counted = await db.recordMovement({
    itemId, kind: "adjust", qty: -1, expiryDate: null,
    reason: "جردٌ شهري: علبةٌ مفقودة", visitId: null, patientId: null, actor: "فحص",
  });
  check("وبسببٍ مكتوب مقبولة", counted.ok, counted.ok ? "" : counted.message);
  check("والرصيد نزل بها", (await db.inventoryBalance(itemId)) === 0);

  const negative = await db.recordMovement({
    itemId, kind: "adjust", qty: -2, expiryDate: null,
    reason: "جرد: البند مفقود كلّه", visitId: null, patientId: null, actor: "فحص",
  });
  check("والتسوية تُنزله تحت الصفر إن كان ذلك واقع الجرد", negative.ok,
    "النقص يُوثَّق ولا يُخفى");
  check("فيُقال «منتهي» لا يُعرض صفرًا مطمئنًا",
    (await db.listInventory()).find((item) => item.id === itemId).status === "out");

  console.log("\n  ── الصلاحية الباقية ──");

  const dated = await db.createInventoryItem({
    name: "مادّة طبع بصلاحية", category: "consumable", unit: "علبة",
    minLevel: 0, note: null, actor: "فحص",
  });
  const datedId = dated.id;
  for (const [qty, expiry] of [[5, "2026-06-01"], [5, "2026-12-01"]]) {
    await db.recordMovement({
      itemId: datedId, kind: "in", qty, expiryDate: expiry,
      reason: null, visitId: null, patientId: null, actor: "فحص",
    });
  }

  const nearestOf = async () =>
    (await db.listInventory(true)).find((item) => item.id === datedId).nearestExpiry;
  const jsNearest = async () => {
    const { nearestExpiry } = await import("../lib/inventory.ts");
    return nearestExpiry(await db.listMovements(datedId, 500));
  };

  check("أقرب دفعةٍ قبل أي صرف", (await nearestOf()) === "2026-06-01", (await nearestOf()) ?? "—");
  check("وتوافق القاعدةُ التطبيقَ", (await nearestOf()) === (await jsNearest()),
    `${await nearestOf()} = ${await jsNearest()}`);

  await db.recordMovement({
    itemId: datedId, kind: "out", qty: 5, expiryDate: null,
    reason: null, visitId: null, patientId: null, actor: "فحص",
  });
  check("ودفعةٌ صُرفت كلّها لا يُنبَّه بها", (await nearestOf()) === "2026-12-01", (await nearestOf()) ?? "—");
  check("وتوافق القاعدةُ التطبيقَ بعد الصرف", (await nearestOf()) === (await jsNearest()),
    `${await nearestOf()} = ${await jsNearest()}`);

  await db.recordMovement({
    itemId: datedId, kind: "out", qty: 5, expiryDate: null,
    reason: null, visitId: null, patientId: null, actor: "فحص",
  });
  check("وصُرف كل ما دخل فلا صلاحيةَ تُعرض", (await nearestOf()) === null, String(await nearestOf()));
  check("وتوافق القاعدةُ التطبيقَ عند الفراغ", (await nearestOf()) === (await jsNearest()));

  console.log("\n  ── الصرف يُنسب إلى زيارة ──");

  const { rows: visitRows } = await db.getPool().query(
    `INSERT INTO visits (patient_name, status) VALUES ('مريض الفحص', 'in_chair') RETURNING id`,
  );
  const visitId = visitRows[0].id;

  const linked = await db.createInventoryItem({
    name: "قفازات الزيارة", category: "consumable", unit: "علبة",
    minLevel: 0, note: null, actor: "فحص",
  });
  await db.recordMovement({
    itemId: linked.id, kind: "in", qty: 10, expiryDate: null,
    reason: null, visitId: null, patientId: null, actor: "فحص",
  });
  await db.recordMovement({
    itemId: linked.id, kind: "out", qty: 3, expiryDate: null,
    reason: null, visitId, patientId: null, actor: "طبيب",
  });

  const onVisit = await db.listVisitMaterials(visitId);
  check("ما صُرف على الزيارة يُقرأ منها", onVisit.length === 1, `${onVisit.length}`);
  check("ومعه اسم البند ووحدته — لا رقمٌ مجرّد",
    onVisit[0]?.itemName === "قفازات الزيارة" && onVisit[0]?.unit === "علبة",
    `${onVisit[0]?.itemName} · ${onVisit[0]?.unit}`);
  check("ونزل من رصيد المخزن نفسه", (await db.inventoryBalance(linked.id)) === 7);
  check("ولا يظهر على زيارةٍ أخرى", (await db.listVisitMaterials(visitId + 999)).length === 0);

  // الردّ حركةُ ردٍّ موسومة لا حذفًا: الرصيد يعود، وأن علبةً خرجت ورجعت يبقى مقروءًا.
  await db.recordMovement({
    itemId: linked.id, kind: "in", qty: 1, expiryDate: null,
    reason: `ردُّ ما لم يُستعمل — زيارة ${visitId}`, visitId, patientId: null,
    actor: "طبيب", isReturn: true,
  });
  const afterReturn = await db.listVisitMaterials(visitId);
  check("والردُّ يُسجَّل ولا يُمحى الصرف", afterReturn.length === 2,
    afterReturn.map((one) => one.kind).join("+"));
  check("والرصيد عاد بمقداره", (await db.inventoryBalance(linked.id)) === 8);

  console.log("\n  ── لا يُردّ أكثر مما صُرف ──");

  const backOnce = await db.recordMovement({
    itemId: linked.id, kind: "in", qty: 2, expiryDate: null,
    reason: "ردٌّ ثانٍ", visitId, patientId: null, actor: "طبيب", isReturn: true,
  });
  check("ما بقي من المصروف يُردّ", backOnce.ok, backOnce.ok ? "" : backOnce.message);
  const backTwice = await db.recordMovement({
    itemId: linked.id, kind: "in", qty: 1, expiryDate: null,
    reason: "ردٌّ ثالث", visitId, patientId: null, actor: "طبيب", isReturn: true,
  });
  check("ثم لا يُردّ ما لم يُصرف — ولا يُصنع مخزونٌ من العدم",
    !backTwice.ok, backTwice.message ?? "");
  check("والرصيد وقف عند حدّه", (await db.inventoryBalance(linked.id)) === 10,
    `${await db.inventoryBalance(linked.id)}`);
  const visitNet = (await db.listVisitMaterials(visitId)).reduce(
    (sum, one) => sum + (one.kind === "out" ? one.qty : one.isReturn ? -one.qty : 0), 0);
  check("وصافي الزيارة صفرٌ لا سالب", visitNet === 0, `${visitNet}`);

  const strayReturn = await db.recordMovement({
    itemId: linked.id, kind: "in", qty: 1, expiryDate: null,
    reason: "ردٌّ بلا زيارة", visitId: null, patientId: null, actor: "طبيب", isReturn: true,
  });
  check("ولا ردَّ بلا زيارةٍ صُرف عليها", !strayReturn.ok, strayReturn.message ?? "");

  console.log("\n  ── الردّ يعيد الصلاحية، والإدخال لا يعيدها ──");

  const dated2 = await db.createInventoryItem({
    name: "مادّةٌ تُردّ بصلاحيتها", category: "consumable", unit: "علبة",
    minLevel: 0, note: null, actor: "فحص",
  });
  const { rows: visit2Rows } = await db.getPool().query(
    `INSERT INTO visits (patient_name, status) VALUES ('مريض الصلاحية', 'in_chair') RETURNING id`,
  );
  const visit2 = visit2Rows[0].id;
  for (const [qty, expiry] of [[4, "2026-06-01"], [4, "2026-12-01"]]) {
    await db.recordMovement({
      itemId: dated2.id, kind: "in", qty, expiryDate: expiry,
      reason: null, visitId: null, patientId: null, actor: "فحص",
    });
  }
  await db.recordMovement({
    itemId: dated2.id, kind: "out", qty: 4, expiryDate: null,
    reason: null, visitId: visit2, patientId: null, actor: "طبيب",
  });
  const nearestOf2 = async () =>
    (await db.listInventory(true)).find((item) => item.id === dated2.id).nearestExpiry;
  check("صُرفت الدفعة القريبة فاختفى تنبيهها", (await nearestOf2()) === "2026-12-01",
    String(await nearestOf2()));

  await db.recordMovement({
    itemId: dated2.id, kind: "in", qty: 4, expiryDate: null,
    reason: "ردُّ ما لم يُستعمل", visitId: visit2, patientId: null, actor: "طبيب", isReturn: true,
  });
  check("ورُدَّت فعاد التنبيه — المادّة على الرفّ وتنتهي في موعدها",
    (await nearestOf2()) === "2026-06-01", String(await nearestOf2()));
  check("وتوافق القاعدةُ التطبيقَ في ذلك", await (async () => {
    const { nearestExpiry } = await import("../lib/inventory.ts");
    return (await nearestOf2()) === nearestExpiry(await db.listMovements(dated2.id, 500));
  })());

  console.log("\n  ── لا حركةَ على زيارةٍ وُقّعت ──");

  await db.getPool().query(`UPDATE visits SET signed_at = NOW() WHERE id = $1`, [visit2]);
  const afterSign = await db.recordMovement({
    itemId: dated2.id, kind: "out", qty: 1, expiryDate: null,
    reason: null, visitId: visit2, patientId: null, actor: "طبيب",
  });
  check("الصرف على زيارةٍ موقَّعة مرفوض — والواجهة وحدها ليست حارسًا",
    !afterSign.ok, afterSign.message ?? "");
  const ghostVisit = await db.recordMovement({
    itemId: dated2.id, kind: "out", qty: 1, expiryDate: null,
    reason: null, visitId: visit2 + 9999, patientId: null, actor: "طبيب",
  });
  check("ولا صرفَ على زيارةٍ لا وجود لها", !ghostVisit.ok, ghostVisit.message ?? "");
  const withoutVisit = await db.recordMovement({
    itemId: dated2.id, kind: "out", qty: 1, expiryDate: null,
    reason: null, visitId: null, patientId: null, actor: "مخزن",
  });
  check("والصرف بلا زيارةٍ يبقى مقبولًا — جردٌ ومخزنٌ لا مريض", withoutVisit.ok,
    withoutVisit.ok ? "" : withoutVisit.message);

  console.log("\n  ── تعديل البند ──");

  const renamed = await db.updateInventoryItem({ id: datedId, minLevel: 3, note: "من المورّد س" });
  check("حدّ الطلب يُعدَّل", renamed.ok, renamed.ok ? "" : renamed.message);
  check("وينعكس على حال البند",
    (await db.listInventory(true)).find((item) => item.id === datedId).minLevel === 3);
  const clash = await db.updateInventoryItem({ id: datedId, name: "قفازات نتريل مقاس M" });
  check("ولا يُعاد تسميته باسمٍ مأخوذ", !clash.ok, clash.message ?? "");
  const belowZero = await db.updateInventoryItem({ id: datedId, minLevel: -1 });
  check("ولا حدَّ طلبٍ سالب", !belowZero.ok, belowZero.message ?? "");

  console.log("\n  ── البند الموقوف ──");

  await db.getPool().query(`UPDATE inventory_items SET is_active = FALSE WHERE id = $1`, [itemId]);
  const stopped = await db.recordMovement({
    itemId, kind: "in", qty: 5, expiryDate: null,
    reason: null, visitId: null, patientId: null, actor: "فحص",
  });
  check("لا حركةَ على بندٍ موقوف", !stopped.ok, stopped.message ?? "");
  check("ولا يظهر في القائمة العادية",
    (await db.listInventory()).every((item) => item.id !== itemId));
  check("ويظهر لمن طلب الموقوفة",
    (await db.listInventory(true)).some((item) => item.id === itemId));

  await db.getPool().end();
} catch (error) {
  console.error(`فشل: ${error.message}`);
  failed = true;
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${temporary}`).catch(() => {});
  await admin.end().catch(() => {});
}
console.log(failed
  ? "\nسقط الفحص."
  : "\nالمخزون سليم: رصيدٌ يُشتقّ من حركاته، ولا يُصرف ما لا يوجد ولو ضغط اثنان معًا.");
process.exit(failed ? 1 : 0);
