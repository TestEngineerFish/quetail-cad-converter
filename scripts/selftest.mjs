#!/usr/bin/env node
/** 契约自测。**一份 dwg 都不需要** —— 为什么见 `fixtures/README.md`。
 *
 *  ⚠️ 它测两样东西，而第二样容易被忘：
 *  ① 源码按契约答话（`--version` / 参数不全 / 文件读不了）；
 *  ② **装配出来的产物**也按契约答话 —— 产物里的 import 是构建脚本改写过的，
 *     改写错了的症状是「源码跑得好好的，而发出去那一份一启动就炸」。
 */
import { execFileSync, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { releaseTarArgs, tarFlavor, tarFlavorFromHelp } from "./archive-tar.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
/* ⚠️ 整行都要对上，不能只查「有一行、里面有 GPL」。
   0.1.2 时 package.json 已是 0.1.2，`--version` 仍印 0.1.1，旧判据照样全绿。
   许可口径停在这一句里的 `GPL-3.0`，不要改成别的写法。 */
const expectedVersionLine = `umbra-dwg2json ${pkg.version} (libredwg-web 0.8.3, GPL-3.0)`;
const run = promisify(execFile);
let pass = 0; const bad = [];
const ok = (c, what, detail = "") => { if (c) { pass++; console.log(`  ✓ ${what}${detail ? `  ${detail}` : ""}`); } else { bad.push(what); console.log(`  ✗ ${what}${detail ? `  ${detail}` : ""}`); } };
/** 跑一次，**退出码和两条流都要**（只看退出码分不清「读不了」和「跑不起来」）。 */
const call = async (exe, args) => {
  try { const r = await run(process.execPath, [exe, ...args], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }); return { code: 0, out: r.stdout, err: r.stderr }; }
  catch (e) { return { code: e.code ?? -1, out: String(e.stdout ?? ""), err: String(e.stderr ?? e.message ?? "") }; }
};

async function contract(label, exe) {
  console.log(`\n${label}`);
  const v = await call(exe, ["--version"]);
  ok(v.code === 0 && v.out.trim().split("\n").length === 1 && v.out.trim().length > 0,
     "`--version` 回一行版本、退出码 0", JSON.stringify(v.out.trim()));
  /* ⚠️ 版本串里**要有 GPL 字样** —— 它是用户唯一看得见「这是另一个程序、另一个许可」
     的地方（Studio 的「组件信息」里直接显示它）。 */
  ok(/GPL/i.test(v.out), "版本串里说得出它的许可", v.out.trim());
  ok(v.out.trim() === expectedVersionLine,
     "`--version` 与 package.json 的 version 一致",
     `期望 ${expectedVersionLine}，实际 ${JSON.stringify(v.out.trim())}`);

  const n = await call(exe, []);
  ok(n.code !== 0 && /用法|usage/i.test(n.err), "参数不全 → 非 0 退出码 + stderr 给用法",
     `code=${n.code} err=${JSON.stringify(n.err.trim().slice(0, 60))}`);

  const box = mkdtempSync(join(tmpdir(), "ucc-self-"));
  const miss = await call(exe, ["--in", join(box, "不存在.dwg"), "--out", join(box, "o.json")]);
  /* ⚠️ 判准是**「说了为什么」**，不只是「失败了」。
     一句没有内容的错误信息比没有错误信息更糟：它看起来像已经解释过了。 */
  ok(miss.code !== 0 && miss.err.trim().length > 0,
     "**文件不存在 → 非 0 + stderr 不是空的**（空的话调用方没法转述）",
     `code=${miss.code} err=${JSON.stringify(miss.err.trim().slice(0, 80))}`);
  ok(!existsSync(join(box, "o.json")), "读不了的时候**一个输出文件都没留下**（半份 JSON 比没有糟）");

  const junk = join(box, "假的.dwg");
  writeFileSync(junk, Buffer.from("这不是 dwg，只是一串字"), "utf8");
  const j = await call(exe, ["--in", junk, "--out", join(box, "j.json")]);
  ok(j.code !== 0 && j.err.trim().length > 0, "**喂一份不是 dwg 的文件 → 非 0 + 说得出话**（不是崩在栈里）",
     `code=${j.code} err=${JSON.stringify(j.err.trim().slice(0, 80))}`);
}

console.log("umbra-cad-converter 契约自测");
await contract("① 源码（src/dwg2json.mjs）", join(ROOT, "src", "dwg2json.mjs"));

/* ── ② 装配出来的产物 ── */
console.log("\n② 产物（dist/ 解包之后）");
const dist = join(ROOT, "dist");
const tar = existsSync(dist) ? readdirSync(dist).find((f) => /^dwg2json-.*\.tar\.gz$/.test(f)) : undefined;
if (!tar) {
  console.log("  — 没有 dist/*.tar.gz，这一节整块跳过（先 `npm run build`）");
  console.log("  ⚠️ **跳过不算通过** —— 发版前必须跑过这一节，不然改写 import 错了没人知道");
} else {
  const box = mkdtempSync(join(tmpdir(), "ucc-pkg-"));
  execFileSync("tar", ["-xzf", join(dist, tar), "-C", box, "--strip-components", "1"], { stdio: "inherit" });
  ok(existsSync(join(box, "dwg2json.mjs")), "产物里有 `dwg2json.mjs`");
  ok(existsSync(join(box, "LICENSE")) && existsSync(join(box, "NOTICE.md")),
     "**许可和归属随产物走**（GPL 要求分发时带上）");
  ok(!existsSync(join(box, "node_modules")), "产物里**没有 `node_modules`**（vendor 是拷进去的）");
  ok(existsSync(join(box, "vendor", "libredwg-web", "wasm", "libredwg-web.wasm")),
     "wasm 在 `vendor/libredwg-web/wasm/` 下（loader 按相对位置找它）");
  const files = []; (function rec(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) rec(p); else files.push(p); } })(box);
  ok(!files.some((f) => /\.(dwg|dxf)$/i.test(f)), "**产物里一份图纸都没有**");
  ok(!files.some((f) => /\.(map|d\.ts)$/.test(f)), "`.map` 与 `.d.ts` 没跟着进产物");
  const sha = createHash("sha256").update(readFileSync(join(dist, tar))).digest("hex");
  const said = readFileSync(join(dist, `${tar}.sha256`), "utf8").trim().split(/\s+/)[0];
  ok(sha === said, "**`.sha256` 文件里写的就是这个包的哈希**（Studio 要按它校验）", `${sha.slice(0, 16)}…`);
  ok(tar === `dwg2json-${pkg.version}.tar.gz`, "包名仍是 `dwg2json-<版本>.tar.gz`", tar);
  ok(readFileSync(join(box, "VERSION"), "utf8") === `umbra-cad-converter ${pkg.version}\n`,
     "VERSION 仍是一行 `umbra-cad-converter <版本>`");
  const packed = ustarMembers(gunzipSync(readFileSync(join(dist, tar))));
  const fixedMtime = Date.parse("2026-01-01T00:00:00Z") / 1000;
  ok(packed.length > 0 && packed.every((m) => m.uid === 0 && m.gid === 0 && m.magic.startsWith("ustar") && m.mtime === fixedMtime),
     "发布 tar.gz 仍是 ustar，uid/gid 为 0，mtime 仍是定死的 2026-01-01T00:00:00Z",
     packed.slice(0, 2).map((m) => `${m.uid}/${m.gid} mtime=${m.mtime} ${m.name}`).join(" · "));
  ok(packed.every((m) => m.typeflag !== "x" && m.typeflag !== "g"), "没有 pax 扩展头（发布格式不变）");
  /* ⚠️ 产物也要过**同一套契约** —— 这一节的全部意义在这里。 */
  await contract("  产物的契约（和源码同一套判据）", join(box, "dwg2json.mjs"));
  console.log(`\n  产物 ${statSync(join(dist, tar)).size} 字节 · 解包 ${files.length} 个文件`);
}

/* ── ③ 实体映射（0.1.1 起可测）──
   ⚠️ **这一节一份 dwg 都不用**：`ent()` 搬进 `src/ent.mjs` 之后，喂几个**形状像 libredwg**
   的自拟对象就能验。字段名取自 libredwg-web 0.8.3 自己的类型声明。
   ⚠️ 为什么非要有这一节：这一段是整个转换器里唯一有分支的地方，而它历史上的三个毛病
   （`POLYLINE2D` 写成 `POLYLINE` 吃掉 52 条线 · `ATTRIB` 的嵌套 `text` 变成 `[object Object]` ·
   **`ELLIPSE` 整支缺失，一张真图上 19 个全进 unknown**）**全都只在真图上露脸**。
   > 一段只能靠真图才验得到的映射，等于一段没有判据的代码。 */
console.log("\n③ 实体映射（自拟数据，不用 dwg）");
{
  const { ent } = await import("../src/ent.mjs");
  /* 整椭圆：参数**原样吐出去**，不在这一侧离散（口径：转换器笨、Studio 聪明） */
  const full = ent({ type: "ELLIPSE", layer: "家具", center: { x: 1000, y: 2000 },
    majorAxisEndPoint: { x: 500, y: 0 }, axisRatio: 0.5, startAngle: 0, endAngle: Math.PI * 2 });
  ok(full && full.t === "ELLIPSE" && full.c[0] === 1000 && full.ma[0] === 500 && full.ratio === 0.5
     && full.a0 === 0 && Math.abs(full.a1 - Math.PI * 2) < 1e-9,
     "**ELLIPSE 出来了**，中心 / 长轴向量 / 轴比 / 起止参数原样", JSON.stringify(full));
  ok(full && !("segments" in full) && !("v" in full),
     "**这一侧不离散**（没有折线点，只有参数）—— 每段几度是 Studio 的取舍");
  const arc = ent({ type: "ELLIPSE", layer: "L", center: { x: 0, y: 0 },
    majorAxisEndPoint: { x: 100, y: 0 }, axisRatio: 0.25, startAngle: 1, endAngle: 2 });
  ok(arc && arc.a0 === 1 && arc.a1 === 2, "椭圆弧（起止参数不是 0..2π）照样吐", JSON.stringify(arc));
  /* 退化的不吐：轴比 0 / 长轴零向量 —— 吐出去后面除它会出 NaN */
  ok(ent({ type: "ELLIPSE", center: { x: 0, y: 0 }, majorAxisEndPoint: { x: 100, y: 0 }, axisRatio: 0 }) === null,
     "轴比 0 的退化椭圆不吐（它不是椭圆，而且后面除它会出 NaN）");
  ok(ent({ type: "ELLIPSE", center: { x: 0, y: 0 }, majorAxisEndPoint: { x: 0, y: 0 }, axisRatio: 1 }) === null,
     "长轴是零向量的也不吐");
  const mir = ent({ type: "ELLIPSE", center: { x: 0, y: 0 }, majorAxisEndPoint: { x: 100, y: 0 },
    axisRatio: 1, startAngle: 0, endAngle: 1, extrusionDirection: { x: 0, y: 0, z: -1 } });
  ok(mir && mir.ez === -1, "挤出方向不是默认的 (0,0,1) 时带出去（镜像的椭圆 z 是 -1）", JSON.stringify(mir));
  ok(!("ez" in (arc ?? {})), "默认挤出方向**不带**那一格（少一个字段，不多一个恒等于 1 的）");

  /* MTEXT：原文，不剥 */
  const mt = ent({ type: "MTEXT", layer: "A-文字", insertionPoint: { x: 10, y: 20 }, textHeight: 300,
    text: "{\\fSimSun|b0;会议室}\\P12 人", rotation: 0.5, attachmentPoint: 5, rectWidth: 1200,
    direction: { x: 1, y: 0 } });
  ok(mt && mt.t === "MTEXT" && mt.p[0] === 10 && mt.h === 300 && mt.att === 5 && mt.w === 1200,
     "**MTEXT 单独一档**，带插入点 / 字高 / 对齐 / 参考宽度", JSON.stringify(mt));
  ok(mt && mt.s.includes("\\f") && mt.s.includes("\\P"),
     "**原文一个字都不剥**（格式码还在）—— 剥码和拆行是 Studio 的事，那些规则还会再调", mt.s);
  /* ⚠️ 空文字框是真实存在的，而「空」和「没认出来」不是一回事 */
  const empty = ent({ type: "MTEXT", insertionPoint: { x: 1, y: 2 }, textHeight: 100, text: "" });
  ok(empty && empty.t === "MTEXT" && empty.s === "",
     "**空的 MTEXT 照样吐**（空文字框是真的；报成 unknown 会让用户以为图读坏了）");
  ok(ent({ type: "MTEXT", textHeight: 100, text: "x" }) === null, "没有插入点的 MTEXT 才回 null");

  /* ── DIMENSION（0.1.2）────────────────────────────────────────────── */
  const P = (x, y) => ({ x, y, z: 0 });
  /* ⚠️⚠️ 这一条是整组里最要紧的：**两个数都要在，而且不许在这里合**。
     `m` 是 CAD 按几何算的，`s` 是人手填的覆盖值 —— 「以标注数字为准」这件事
     的全部意义就在两者可以不一样（线画到 2775、标注写 2770）。
     在这里取一个「最终值」等于把那个差抹掉，而那个差正是要报给用户的 `dim_conflicts`。 */
  const dim = ent({ type: "DIMENSION", layer: "DIM-外道", dimensionType: 32,
    definitionPoint: P(0, -500), subDefinitionPoint1: P(0, 0), subDefinitionPoint2: P(2775, 0),
    measurement: 2775, text: "2770" });
  ok(dim && dim.t === "DIMENSION" && dim.m === 2775 && dim.s === "2770",
     "**线性标注：`m`（CAD 算的）和 `s`（人写的）两个数都吐，不合**", JSON.stringify(dim));
  ok(dim && dim.a[0] === 0 && dim.b[0] === 2775 && dim.d[1] === -500 && dim.k === "rot",
     "两个定义点 + 标注线位置 + 类型都在（全取 WCS，**不碰 OCS 的 `textPoint`**）", JSON.stringify(dim));
  /* ⚠️⚠️ **类型要按低三位判**：32 / 64 / 128 是位标志加在整数值上的，
     而 32 在 R13 之后**永远是 1**。直接 `=== 0` 会把每一条标注都判成「不是线性的」—— 
     症状是「这张图一条标注都没读到」，而那和「这张图没有标注」长得一模一样。 */
  ok(dim !== null, "**`dimensionType` 带着 32 位标志也要认**（R13 之后它永远是 1）",
     `dimensionType=32 → ${dim ? dim.k : "null"}`);
  const aln = ent({ type: "DIMENSION", layer: "DIM", dimensionType: 33,
    definitionPoint: P(0, -1), subDefinitionPoint1: P(0, 0), subDefinitionPoint2: P(1000, 0), measurement: 1000 });
  ok(aln && aln.k === "aln" && aln.m === 1000 && aln.s === undefined,
     "对齐标注认得出来；**没有覆盖文字时不编一个 `s` 出来**", JSON.stringify(aln));
  /* ⚠️ `text` 是三态（`null` / `""` / `"<>"` 用 measurement · 一个空格 = 抑制 · 其它 = 画出来的），
     所以**原样吐、不 trim** —— 判这三态是 Studio 的事。
     这里钉的是「一个空格活着到了另一边」：trim 一下它就变成空串，而空串是另一档。 */
  const sup = ent({ type: "DIMENSION", layer: "DIM", dimensionType: 32,
    definitionPoint: P(0, -1), subDefinitionPoint1: P(0, 0), subDefinitionPoint2: P(50, 0), measurement: 50, text: " " });
  ok(sup && sup.s === " ", "**「一个空格」原样活着到另一边**（它的意思是「文字被抑制」，trim 掉就变成另一档）",
     JSON.stringify(sup.s));
  /* 这一轮刻意不要的那几种 —— 回 null 进 skipped，而宿主本来就把 DIMENSION 算在「建模不需要」里 */
  for (const [dt, name] of [[34, "角度"], [35, "直径"], [36, "半径"], [37, "三点角度"], [38, "坐标"]]) {
    ok(ent({ type: "DIMENSION", layer: "DIM", dimensionType: dt,
      definitionPoint: P(0, 0), subDefinitionPoint1: P(0, 0), subDefinitionPoint2: P(1, 1) }) === null,
      `${name}标注这一轮不要（回 null，计进 skipped）`);
  }
  ok(ent({ type: "DIMENSION", layer: "DIM", dimensionType: 32, definitionPoint: P(0, 0) }) === null,
     "缺定义点的标注回 null（不吐半条）");

  /* 老那几支不许被这一轮带坏 */
  const at = ent({ type: "ATTRIB", layer: "图框", text: { text: "一层平面布置图", startPoint: { x: 5, y: 6 }, textHeight: 250 } });
  ok(at && at.t === "TEXT" && at.s === "一层平面布置图" && at.p[0] === 5 && at.h === 250,
     "`ATTRIB` 的**嵌套** `text` 照旧取得对（不是 `[object Object]`）", JSON.stringify(at));
  const pl = ent({ type: "POLYLINE2D", layer: "墙", vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }], flag: 1 });
  ok(pl && pl.t === "LWPOLYLINE" && pl.closed === true, "`POLYLINE2D` 照旧认得（曾经吃掉 52 条线）");
  ok(ent({ type: "HATCH", layer: "填充" }) === null, "认不出的类型照旧回 null（计进 `skipped`，按类型分开记）");

  /* ⚠️ **映射只有一处**：块里的实体和顶层走的是同一个 `conv()` → `ent()`。
     这一条钉的不是行为而是结构 —— 哪天有人在 `dwg2json.mjs` 里又写一个 switch，
     块里的椭圆就会和顶层的分叉，而那种分叉在读数上长得像「块里的没认出来」。 */
  const srcText = readFileSync(new URL("../src/dwg2json.mjs", import.meta.url), "utf8");
  ok(!/case "LINE"/.test(srcText) && /from "\.\/ent\.mjs"/.test(srcText),
     "**实体映射只有一处**（`dwg2json.mjs` 里没有第二个 switch，块和顶层共用 `ent()`）");
}

/* ── ④ 打包参数 ──
   ⚠️ Ubuntu CI 的 GNU tar 不认 bsdtar 的 `--uid`（`tar: unrecognized option '--uid'`）。
   这里用**当前平台的 tar** 真打一个包，并要求头里 uid/gid 仍是 0、格式仍是 ustar。
   macOS 那组参数在 Linux 上跑不了，所以只钉参数表本身：必须仍是原来的 `--uid/--gid/--no-mac-metadata`。 */
console.log("\n④ 打包参数（GNU tar 与 macOS bsdtar 各一组，不混用）");
{
  const bsd = releaseTarArgs({ stage: "S", archive: "A", filelist: "F", flavor: "bsd" });
  ok(bsd.join(" ") === "--format ustar --uid 0 --gid 0 --numeric-owner --no-mac-metadata --no-xattrs -C S -cf A -T F",
     "macOS bsdtar 的参数与原来那一组相同", bsd.join(" "));
  const gnu = releaseTarArgs({ stage: "S", archive: "A", filelist: "F", flavor: "gnu" });
  ok(!gnu.includes("--uid") && !gnu.includes("--no-mac-metadata")
     && gnu.includes("--owner=0") && gnu.includes("--group=0")
     && gnu.includes("--numeric-owner") && gnu.includes("--no-xattrs") && gnu.includes("ustar"),
     "GNU tar 用 --owner=0 --group=0，不用 --uid / --no-mac-metadata", gnu.join(" "));
  ok(tarFlavorFromHelp("      --owner=NAME           force NAME as owner\n      --no-xattrs\n") === "gnu",
     "只有 --owner、没有 --uid 的 help 认成 GNU tar");
  ok(tarFlavorFromHelp("      --uid id\n      --gid id\n      --no-mac-metadata\n") === "bsd",
     "有 --uid 和 --no-mac-metadata 的 help 认成 macOS bsdtar");
  ok(tarFlavorFromHelp("usage: tar") === "unknown", "help 里两边的参数都没有 → unknown");
  let unknown = "";
  try { releaseTarArgs({ stage: "S", archive: "A", filelist: "F", flavor: "unknown" }); }
  catch (error) { unknown = String(error.message ?? error); }
  ok(unknown.includes("不认识的 tar"), "不认识的 tar 直接失败，不猜参数");
  let help = "";
  try { help = execFileSync("tar", ["--help"], { encoding: "utf8" }); }
  catch (error) { help = `${error.stdout ?? ""}\n${error.stderr ?? ""}`; }
  const flavor = tarFlavor();
  ok(flavor === tarFlavorFromHelp(help) && (flavor === "gnu" || flavor === "bsd"),
     "当前 tar 能识别，且和 `tar --help` 一致", flavor);

  const stage = mkdtempSync(join(tmpdir(), "ucc-tar-stage-"));
  const scratch = mkdtempSync(join(tmpdir(), "ucc-tar-out-"));
  writeFileSync(join(stage, "hello.txt"), "hi\n");
  const filelist = join(scratch, "filelist.txt");
  const archive = join(scratch, "pkg.tar");
  writeFileSync(filelist, "hello.txt\n");
  let packedOk = true;
  let packErr = "";
  try {
    execFileSync("tar", releaseTarArgs({ stage, archive, filelist }), {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    packedOk = false;
    packErr = `${error.stderr ?? error.message ?? error}`.trim();
  }
  const members = packedOk ? ustarMembers(readFileSync(archive)) : [];
  ok(packedOk && members.length === 1 && members[0].uid === 0 && members[0].gid === 0 && members[0].magic.startsWith("ustar"),
     "用发布脚本的 tar 参数打一个包：成功，且 ustar 头里 uid/gid 为 0",
     packedOk ? JSON.stringify(members[0]) : packErr.slice(0, 180));
}

console.log(`\n${bad.length === 0 ? "✓" : "✗"} 契约自测 ${pass}/${pass + bad.length}`);
if (bad.length) { bad.forEach((b) => console.log(`  ✗ ${b}`)); process.exit(1); }

function ustarMembers(buf) {
  const members = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, len) => header.subarray(start, start + len).toString("utf8").replace(/\0.*$/, "").trim();
    const name = field(0, 100);
    const prefix = field(345, 155);
    const size = parseInt(field(124, 12) || "0", 8);
    members.push({
      name: prefix ? `${prefix}/${name}` : name,
      uid: parseInt(field(108, 8) || "0", 8),
      gid: parseInt(field(116, 8) || "0", 8),
      mtime: parseInt(field(136, 12) || "0", 8),
      magic: header.subarray(257, 263).toString("utf8").replace(/\0.*$/, ""),
      typeflag: String.fromCharCode(header[156]),
    });
    off += 512 * (1 + (Number.isFinite(size) && size > 0 ? Math.ceil(size / 512) : 0));
  }
  return members;
}
