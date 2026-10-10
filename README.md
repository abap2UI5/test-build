# test-build

abap2UI5 and its frontend, renamed into a namespace of your choice and
assembled as **one abapGit repository** on a branch of this repository - for a
parallel installation next to an existing abap2UI5, or for a system that
installs everything under a registered namespace.

| Input | Backend objects | Frontend BSP | Branch |
|---|---|---|---|
| `/ABAP2UI5/` | `/abap2ui5/cl_ui5_client`, ... | `/ABAP2UI5/UI5`, node `/sap/bc/abap2ui5/ui5` | `rename_abap2ui5` |
| `ZABAP2UI5Z` | `zabap2ui5z_cl_ui5_client`, ... | `ZABAP2UI5Z`, node `/sap/bc/zabap2ui5z` | `rename_zabap2ui5z` |

## Run it

**GitHub**: Actions → `rename` → Run workflow → enter the name. The result is
pushed to `rename_<name>`; re-running with the same name updates that branch.
Optionally a branch or tag of abap2UI5 and of frontend-new to rename.

**Locally**:

```bash
npm ci
node rename.mjs /abap2ui5/                 # clones both repositories into work/, result in out/rename_abap2ui5/
node rename.mjs zabap2ui5z --abap2ui5 ../abap2UI5 --frontend ../frontend-new   # existing checkouts
```

## What it does

1. Clones [abap2UI5/abap2UI5](https://github.com/abap2UI5/abap2UI5) and
   [abap2UI5/frontend-new](https://github.com/abap2UI5/frontend-new) (`main`
   by default).
2. Renames the backend with abap2UI5's own rename config
   (`.github/abaplint/rename.jsonc`, what its `build-rename` workflow uses):
   `abaplint --rename` turns every `z2ui5_*` class, interface and table into
   `<prefix>*` and rewrites every reference. abap2UI5's `rename-literal-gate`
   then proves no string literal still names an object by its old name.
3. Renames the frontend BSP with abap2UI5's `tools/bsp_rename` (BSP, ICF
   nodes, SMIM folder, handler class, file names; for a `/NS/` the nodes move
   to `/sap/bc/<ns>/ui5` and the namespace-level nodes are generated). Two
   things that script keeps for an unrenamed backend are rewritten here:
   the handler's call of the backend class (`<prefix>cl_ui5_http_handler`)
   and the endpoint the embed control loads the frontend from (set on the
   control in the view, the renamed node).
4. Assembles `.abapgit.xml`, `LICENSE`, a `README.md` with the install steps
   and `src/`: the backend's packages `00`..`99` plus `src/frontend/` with the
   frontend's `01` (handler and node) and `02` (BSP and nodes).

Rules for the name are abap2UI5's: a customer name has at most 10 characters,
a registered namespace at most 10 with both slashes (every abap2UI5 object
name is at most 25 characters, so the renamed one stays within ABAP's 30).
`z2ui5` is refused. A `/NS/` namespace has to exist in the target system
(SE03) before the pull.

## Install the result

abapGit → New Online → this repository, branch `rename_<name>` → a package of
yours (in the namespace, for a `/NS/` name) → Pull. Then activate the ICF nodes
the branch's README lists and open its `index.html`. The frontend packages are
`<package>_FRONTEND`, `_FRONTEND_01`, `_FRONTEND_02` (abapGit's PREFIX folder
logic).

## Checks

```bash
npm test      # the name derivation
```
