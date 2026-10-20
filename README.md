# test-build

abap2UI5 and its frontend, renamed into a namespace of your choice and
assembled as **one abapGit repository** on a branch of this repository - for a
parallel installation next to an existing abap2UI5, or for a system that
installs everything under a registered namespace.

| Input | Backend objects | Frontend BSP | Branch |
|---|---|---|---|
| `/CA2UI5/` | `/ca2ui5/cl_ui5_client`, ... | `/CA2UI5/UI5`, node `/sap/bc/ca2ui5/ui5` | `rename_ca2ui5` |
| `/ABAP2UI5/` | `/abap2ui5/cl_ui5_client`, ... | `/ABAP2UI5/UI5`, node `/sap/bc/abap2ui5/ui5` | `rename_abap2ui5` |
| `ZABAP2UI5Z` | `zabap2ui5z_cl_ui5_client`, ... | `ZABAP2UI5Z`, node `/sap/bc/zabap2ui5z` | `rename_zabap2ui5z` |

## Run it

**GitHub**: Actions → `rename` → Run workflow → enter the name. The result is
pushed to `rename_<name>`; re-running with the same name updates that branch.
Optionally a branch or tag of abap2UI5 and of the frontend to rename.

**Locally**:

```bash
npm ci
node rename.mjs /abap2ui5/                 # clones both repositories into work/, result in out/rename_abap2ui5/
node rename.mjs zabap2ui5z --abap2ui5 ../abap2UI5 --frontend ../frontend   # existing checkouts (frontend on standard_new)
```

## What it does

1. Clones [abap2UI5/abap2UI5](https://github.com/abap2UI5/abap2UI5) (`main`)
   and the branch `standard_new` of [abap2UI5/frontend](https://github.com/abap2UI5/frontend)
   - the frontend app around the embed control, which loads the abap2UI5
   frontend from the backend.
2. Renames the backend with abap2UI5's own rename config
   (`.github/abaplint/rename.jsonc`, what its `build-rename` workflow uses):
   `abaplint --rename` turns every `z2ui5_*` class, interface and table into
   `<prefix>*` and rewrites every reference. abap2UI5's `rename-literal-gate`
   then proves no string literal still names an object by its old name.
3. Renames the frontend BSP with abap2UI5's `tools/bsp_rename` (BSP, ICF
   nodes, SMIM folder, handler class, file names; for a `/NS/` the nodes move
   to `/sap/bc/<ns>/ui5` and the namespace-level nodes are generated). The
   one thing that script keeps for an unrenamed backend is rewritten here:
   the handler's call of the backend class (`<prefix>cl_ui5_http_handler`).
   The endpoint the embed control loads the frontend from is the manifest's
   data source, which the script repoints at the renamed node - checked
   here, so a frontend that takes it from elsewhere stops the run.
4. Assembles `.abapgit.xml`, `LICENSE`, a `README.md` with the install steps
   and `src/` with two folders: `src/01` the backend (its packages `00`..`99`
   below it) and `src/02` the frontend (`01` handler and node, `02` BSP and
   nodes).
5. Runs abaplint on the result with the `abaplint.jsonc` it writes to the
   branch (syntax v750, the API abap2UI5 is checked against plus
   [abaplint/deps](https://github.com/abaplint/deps) for the frontend
   handler's on-premise interfaces). The outcome is the badge of the branch
   README (`.badges/abaplint.json`, a shields.io endpoint). The branch is
   pushed either way; issues fail the workflow run after the push.

Rules for the name are abap2UI5's: a customer name has at most 10 characters,
a registered namespace at most 10 with both slashes (every abap2UI5 object
name is at most 25 characters, so the renamed one stays within ABAP's 30).
`z2ui5` is refused. A `/NS/` namespace has to exist in the target system
(SE03) before the pull.

## Branches

| Branch | abaplint |
|---|---|
| [`rename_ca2ui5`](https://github.com/abap2UI5/test-build/tree/rename_ca2ui5) | ![abaplint](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fabap2UI5%2Ftest-build%2Frename_ca2ui5%2F.badges%2Fabaplint.json) |

## Install the result

abapGit → New Online → this repository, branch `rename_<name>` → a package of
yours (in the namespace, for a `/NS/` name) → Pull. Then activate the ICF nodes
the branch's README lists and open its `index.html`. The packages are `<package>_01`
(backend, with `_01_00` .. `_01_99`) and `<package>_02` (frontend, with
`_02_01`, `_02_02`) - abapGit's PREFIX folder logic.

## Checks

```bash
npm test      # the name derivation, the lint config and the badge
```
