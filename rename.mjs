#!/usr/bin/env node
// rename.mjs - abap2UI5 and its frontend (abap2UI5/frontend-new) renamed into
// a namespace of your choice, assembled as ONE abapGit repository.
//
//   node rename.mjs /abap2ui5/            registered namespace  -> /abap2ui5/cl_ui5_client, BSP /ABAP2UI5/UI5
//   node rename.mjs zabap2ui5z            customer name         -> zabap2ui5z_cl_ui5_client, BSP ZABAP2UI5Z
//
// What happens:
//   1. abap2UI5/abap2UI5 and abap2UI5/frontend-new are cloned (main, or the
//      --abap2ui5-ref / --frontend-ref given) into work/
//   2. the backend is renamed with abap2UI5's own rename config
//      (.github/abaplint/rename.jsonc, the one its build-rename workflow
//      uses): abaplint --rename rewrites every z2ui5_* object and every
//      reference to it. abap2UI5's rename-literal-gate then proves no string
//      literal still names an object by its old name
//   3. the frontend BSP is renamed with abap2UI5's tools/bsp_rename
//      (BSP, ICF nodes, SMIM, handler class, file names; for a /NS/ the nodes
//      move to /sap/bc/<ns>/ui5 and the namespace-level nodes are generated).
//      Two things that script keeps on purpose are rewritten here, because
//      here the backend IS renamed: the handler's call of the backend class
//      (z2ui5_cl_ui5_http_handler -> <prefix>cl_ui5_http_handler) and the
//      endpoint the embed control loads the frontend from (its default is
//      /sap/bc/z2ui5; the renamed node is set on the control in the view)
//   4. the result lands in out/<branch>/: .abapgit.xml, LICENSE, README.md
//      and src/ - the backend's packages 00..99 plus src/frontend/ with the
//      frontend's 01 (handler + node) and 02 (BSP + nodes). One pull installs
//      the whole renamed stack; abapGit's PREFIX folder logic names the
//      frontend packages <your package>_FRONTEND, _FRONTEND_01, _FRONTEND_02
//
// The namespace rules are abap2UI5's (build-rename.yaml, rename.jsonc,
// tools/bsp_rename): a customer name has at most 10 characters (prefix
// <name>_, 11), a registered namespace at most 10 with both slashes - every
// object name in abap2UI5 is at most 25 characters, which keeps the renamed
// name within ABAP's 30. z2ui5 itself is refused: nothing to rename.
//
// Options:
//   --out <dir>             where the result goes (default: out/<branch>)
//   --abap2ui5 <path>       an existing checkout of abap2UI5/abap2UI5 instead of a clone
//   --frontend <path>       an existing checkout of abap2UI5/frontend-new instead of a clone
//   --abap2ui5-ref <ref>    branch/tag to clone (default: main)
//   --frontend-ref <ref>    branch/tag to clone (default: main)
//   --abaplint <path>       the abaplint binary (default: this package's node_modules/.bin/abaplint)
//
// Needs: node >= 22, git, and `npm ci` here (for @abaplint/cli). Nothing is
// installed into the checkouts.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPOS = {
  abap2ui5: "https://github.com/abap2UI5/abap2UI5.git",
  frontend: "https://github.com/abap2UI5/frontend-new.git",
};
const OLD = "z2ui5";
// the backend classes a frontend handler may call: frontend-new calls the
// public z2ui5_cl_ui5_http_handler, abap2UI5/frontend the frozen
// z2ui5_cl_http_handler of src/99 (an empty subclass, renamed as well)
const BACKEND_CALL = /z2ui5_cl_(ui5_)?http_handler/gi;
// abapGit stores a BSP page with every line padded to 255 characters
const BSP_LINE_WIDTH = 255;

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { name: null, out: null, abap2ui5: null, frontend: null, abap2ui5Ref: "main", frontendRef: "main", abaplint: null };
  const valued = { "--out": "out", "--abap2ui5": "abap2ui5", "--frontend": "frontend", "--abap2ui5-ref": "abap2ui5Ref", "--frontend-ref": "frontendRef", "--abaplint": "abaplint" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") { o.help = true; continue; }
    if (valued[a]) {
      if (argv[i + 1] === undefined) fail(`${a} needs a value`);
      o[valued[a]] = argv[++i];
    } else if (a.startsWith("-")) fail(`unknown option ${a}`);
    else if (o.name === null) o.name = a;
    else fail(`unexpected argument ${a}`);
  }
  return o;
}

function fail(message) {
  console.error(`rename: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// the names: what z2ui5 becomes everywhere
// ---------------------------------------------------------------------------
export function deriveNames(input) {
  const ns = String(input ?? "").trim().toLowerCase().replace(/#/g, "/");
  if (!ns) throw new Error("a name is needed: a customer name (zabap2ui5z) or a namespace with both slashes (/abap2ui5/)");
  if (/^[a-z][a-z0-9_]*$/.test(ns)) {
    if (ns === OLD) throw new Error(`'${input}' is the original name - nothing to rename`);
    if (ns.length > 10) throw new Error(`'${ns}' has ${ns.length} characters; a customer name has at most 10`);
    if (!/^[zy]/.test(ns)) console.warn(`  ! ${ns.toUpperCase()} does not start with Z or Y - outside the SAP customer namespace`);
    return {
      kind: "name",
      prefix: `${ns}_`,                       // zabap2ui5z_   (object prefix, replaces z2ui5_)
      frontendName: ns.toUpperCase(),         // ZABAP2UI5Z    (BSP, what rename-bsp.mjs takes)
      endpoint: `/sap/bc/${ns}`,              // the renamed ICF node of the handler
      branch: `rename_${ns}`,
      label: ns.toUpperCase(),
    };
  }
  if (/^\/[a-z0-9][a-z0-9_]*\/$/.test(ns)) {
    if (ns.length > 10) throw new Error(`'${ns}' has ${ns.length} characters; a namespace has at most 10 with both slashes`);
    const bare = ns.slice(1, -1);
    return {
      kind: "namespace",
      prefix: ns,                             // /abap2ui5/
      frontendName: ns.toUpperCase(),         // /ABAP2UI5/  -> rename-bsp makes the BSP /ABAP2UI5/UI5
      endpoint: `/sap/bc/${bare}/ui5`,        // the renamed ICF node of the handler
      branch: `rename_${bare}`,
      label: ns.toUpperCase(),
      bare,
    };
  }
  throw new Error(`'${input}' is neither a customer name (letter, then letters/digits/_, max. 10) nor a namespace with both slashes (/abap2ui5/, max. 10)`);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8", ...opts });
  if (r.status !== 0) {
    if (opts.quiet) process.stderr.write(r.stdout ?? ""), process.stderr.write(r.stderr ?? "");
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
  }
  return r.stdout;
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

// the first directory of that name below root, depth first
function findDir(root, name) {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(root, e.name);
    if (e.name === name) return p;
    const found = findDir(p, name);
    if (found) return found;
  }
  return null;
}

function clone(url, ref, target) {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  console.log(`\nclone ${url} (${ref}) -> ${target}`);
  run("git", ["clone", "--depth", "1", "--branch", ref, url, target]);
}

function head(checkout) {
  try {
    return execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "(no git)";
  }
}

// Re-pad a BSP page after an edit: only lines that are not 255 wide are the
// edited ones; an over-long one is wrapped into 255-character chunks the way
// abap2UI5's app2bsp writes them. No trailing newline, as stored.
function repadBspPage(content) {
  const out = [];
  for (const line of content.split("\n")) {
    if (line.length === BSP_LINE_WIDTH) { out.push(line); continue; }
    const text = line.replace(/ +$/, "");
    if (!text) { out.push("".padEnd(BSP_LINE_WIDTH)); continue; }
    for (let o = 0; o < text.length; o += BSP_LINE_WIDTH) out.push(text.slice(o, o + BSP_LINE_WIDTH).padEnd(BSP_LINE_WIDTH));
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// 2. the backend
// ---------------------------------------------------------------------------
function renameBackend(N, checkout, abaplint) {
  console.log(`\n== backend: ${OLD}_* -> ${N.prefix}* (abaplint --rename, abap2UI5's rename.jsonc)`);
  const cfgDir = join(checkout, ".github/abaplint");
  const template = readFileSync(join(cfgDir, "rename.jsonc"), "utf8");
  if (!template.includes("znamespace_")) throw new Error("rename.jsonc: placeholder znamespace_ not found - abap2UI5 changed its rename config");
  const cfg = join(cfgDir, "rename_run.jsonc");
  // the same substitution build-rename.yaml makes; `|` would be the sed
  // delimiter there, here it is a plain string replace
  writeFileSync(cfg, template.split("znamespace_").join(N.prefix));
  const output = join(cfgDir, "output");
  rmSync(output, { recursive: true, force: true });
  // the dependency (steampunk API intersect) is cloned by abaplint from the
  // url in the config when node/deps/ is not populated - it is not, here
  run(abaplint, [cfg, "--rename"], { cwd: checkout, quiet: true });
  rmSync(cfg);

  // abaplint writes <output>/<absolute path of the checkout>/src
  const src = findDir(output, "src");
  if (!src) throw new Error(`no renamed src folder under ${output}`);

  console.log("   literal gate (abap2UI5's rename-literal-gate.mjs --renamed)");
  run("node", [join(checkout, ".github/scripts/rename-literal-gate.mjs"), "--renamed", output], { cwd: checkout, quiet: true });

  const files = [...walk(src)];
  console.log(`   ${files.length} files renamed`);
  return { src, output };
}

// ---------------------------------------------------------------------------
// 3. the frontend
// ---------------------------------------------------------------------------
function renameFrontend(N, feCheckout, abap2ui5Checkout, work) {
  console.log(`\n== frontend: BSP Z2UI5 -> ${N.frontendName}${N.kind === "namespace" ? "UI5" : ""} (abap2UI5's tools/bsp_rename)`);
  const stage = join(work, "frontend-renamed");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(join(feCheckout, "src"), join(stage, "src"), { recursive: true });

  const renameBsp = join(abap2ui5Checkout, "tools/bsp_rename/rename-bsp.mjs");
  if (!existsSync(renameBsp)) throw new Error(`${renameBsp} not found`);
  run("node", [renameBsp, N.frontendName, "--yes", "--dir", "src"], { cwd: stage, quiet: true });

  // the handler's call of the backend: kept by rename-bsp (a contract with
  // an unrenamed backend), rewritten here because the backend is renamed too
  let handlers = 0;
  for (const p of walk(join(stage, "src"))) {
    if (!p.endsWith(".clas.abap")) continue;
    const before = readFileSync(p, "utf8");
    const after = before.replace(BACKEND_CALL, (m, ui5) => {
      const stem = `cl_${ui5 ? "ui5_" : ""}http_handler`;
      return m === m.toUpperCase() ? `${N.prefix}${stem}`.toUpperCase() : `${N.prefix}${stem}`;
    });
    if (after !== before) { writeFileSync(p, after); handlers++; }
  }
  if (handlers !== 1) throw new Error(`expected exactly one handler class calling the backend, found ${handlers}`);
  console.log(`   handler calls ${N.prefix}cl_ui5_http_handler`);

  // the endpoint the embed control loads the frontend from: its default is
  // /sap/bc/z2ui5, the renamed node is set on the control in the view page
  const views = [...walk(join(stage, "src"))].filter((p) => p.endsWith(".wapa.view_-main.view.xml"));
  if (views.length !== 1) throw new Error(`expected one main view page, found ${views.length}`);
  const view = views[0];
  const page = readFileSync(view, "utf8");
  if (/\bendpoint=/.test(page)) throw new Error(`${basename(view)}: the control already has an endpoint - frontend-new changed`);
  const lines = page.split("\n");
  const at = lines.findIndex((l) => /<z2ui5:Container\s*$/.test(l));
  if (at < 0) throw new Error(`${basename(view)}: <z2ui5:Container not found`);
  const indent = (lines[at + 1].match(/^ */) ?? [""])[0];
  lines.splice(at + 1, 0, `${indent}endpoint="${N.endpoint}"`);
  writeFileSync(view, repadBspPage(lines.join("\n")));
  console.log(`   control endpoint ${N.endpoint}`);
  return join(stage, "src");
}

// ---------------------------------------------------------------------------
// 4. the result
// ---------------------------------------------------------------------------
function assemble(N, out, backend, frontendSrc, abap2ui5Checkout, feCheckout) {
  console.log(`\n== assemble ${out}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(backend.src, join(out, "src"), { recursive: true });
  cpSync(frontendSrc, join(out, "src/frontend"), { recursive: true });
  cpSync(join(abap2ui5Checkout, "LICENSE"), join(out, "LICENSE"));
  const abapgit = readFileSync(join(abap2ui5Checkout, ".abapgit.xml"), "utf8");
  if (!abapgit.includes("Z2UI5_IF_APP")) throw new Error(".abapgit.xml: Z2UI5_IF_APP not found");
  writeFileSync(join(out, ".abapgit.xml"), abapgit.replace("Z2UI5_IF_APP", `${N.prefix}IF_APP`.toUpperCase()));

  const a = head(abap2ui5Checkout);
  const f = head(feCheckout);
  const bsp = N.kind === "namespace" ? `${N.label}UI5` : N.label;
  const handler = N.kind === "namespace" ? `${N.label}CL_LP_HANDLER` : `${N.label}_CL_LP_HANDLER`;
  const sicf = N.kind === "namespace"
    ? [`/sap/bc/${N.bare}/ui5`, `/sap/bc/ui5_ui5/${N.bare}/ui5`, `/sap/bc/bsp/${N.bare}/ui5`, `(and the namespace nodes /sap/bc/${N.bare}, /sap/bc/ui5_ui5/${N.bare}, /sap/bc/bsp/${N.bare})`]
    : [`/sap/bc/${N.prefix.slice(0, -1)}`, `/sap/bc/ui5_ui5/sap/${N.prefix.slice(0, -1)}`, `/sap/bc/bsp/sap/${N.prefix.slice(0, -1)}`];
  const index = N.kind === "namespace" ? `/sap/bc/ui5_ui5/${N.bare}/ui5/index.html` : `/sap/bc/ui5_ui5/sap/${N.prefix.slice(0, -1)}/index.html`;
  writeFileSync(join(out, "README.md"), `# abap2UI5 renamed to ${N.label}

Generated by [abap2UI5/test-build](https://github.com/abap2UI5/test-build) - do not edit, re-run the workflow.

| | |
|---|---|
| backend | abap2UI5/abap2UI5@${a}, every \`z2ui5_*\` object renamed to \`${N.prefix}*\` |
| frontend | abap2UI5/frontend-new@${f}, BSP \`${bsp}\`, handler \`${handler}\` calling \`${N.prefix}cl_ui5_http_handler\` |
| \`src/\` | the backend (packages 00..99) |
| \`src/frontend/\` | the frontend: \`01\` handler and ICF node, \`02\` BSP and its nodes |

## Install

${N.kind === "namespace" ? `1. The namespace \`${N.label}\` has to exist in the system (SE03, changeable, with a developer license) and a package of that namespace to pull into.\n` : "1. Create a package to pull into.\n"}2. abapGit: New Online, this repository, branch \`${N.branch}\`, that package, Pull. The frontend packages are named \`<package>_FRONTEND\`, \`_FRONTEND_01\`, \`_FRONTEND_02\` (abapGit's PREFIX folder logic).
3. SICF: activate ${sicf.join(", ")}.
4. Open \`${index}\`.
`);
  const n = [...walk(out)].length;
  console.log(`   ${n} files`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.name) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
    process.exit(o.help ? 0 : 2);
  }
  let N;
  try {
    N = deriveNames(o.name);
  } catch (e) {
    fail(e.message);
  }
  const abaplint = o.abaplint ?? join(here, "node_modules/.bin/abaplint");
  if (!existsSync(abaplint)) fail(`${abaplint} not found - run npm ci here first`);

  const work = join(here, "work");
  mkdirSync(work, { recursive: true });
  let abap2ui5 = o.abap2ui5 ? resolve(o.abap2ui5) : join(work, "abap2UI5");
  let frontend = o.frontend ? resolve(o.frontend) : join(work, "frontend-new");
  if (!o.abap2ui5) clone(REPOS.abap2ui5, o.abap2ui5Ref, abap2ui5);
  if (!o.frontend) clone(REPOS.frontend, o.frontendRef, frontend);
  for (const [what, dir, marker] of [["abap2UI5", abap2ui5, ".github/abaplint/rename.jsonc"], ["frontend-new", frontend, "src/01"]]) {
    if (!existsSync(join(dir, marker))) fail(`${dir} is not a checkout of abap2UI5/${what} (${marker} missing)`);
  }

  console.log(`\nRename abap2UI5 to ${N.label}  (${OLD}_ -> ${N.prefix}, branch ${N.branch})`);
  const out = o.out ? resolve(o.out) : join(here, "out", N.branch);
  const backend = renameBackend(N, abap2ui5, abaplint);
  const frontendSrc = renameFrontend(N, frontend, abap2ui5, work);
  assemble(N, out, backend, frontendSrc, abap2ui5, frontend);
  console.log(`\nOK: ${out}  (branch ${N.branch})`);
  // for the workflow
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `branch=${N.branch}\nout=${out}\n`, { flag: "a" });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    fail(e.message);
  }
}
