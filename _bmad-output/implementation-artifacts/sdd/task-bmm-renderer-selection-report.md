# Task Report: BMM renderer selection

## Status

Complete.

## Change

`_bmad/scripts/render_skill.py` now reads the installed skill's owning module
from `_bmad/_config/skill-manifest.csv`. A short configuration token remains
resolved exactly as before when its key is globally unique. If it is ambiguous,
the renderer selects the exact `modules.<owning-module>.<key>` value when one
exists; otherwise it retains the existing ambiguity halt.

For `bmad-build`, `{{.implementation_artifacts}}` therefore resolves to
`config.modules.bmm.implementation_artifacts`, rather than competing with the
GDS value.

## Verification

- `python _bmad/scripts/render_skill.py --project-root C:\\Users\\Bot\\Desktop\\stash --skill C:\\Users\\Bot\\Desktop\\stash\\.agents\\skills\\bmad-build`
  exited 0 and printed the generated `workflow.md` path.
- The generated `manifest.json` records both
  `config.modules.bmm.implementation_artifacts` and
  `config.modules.bmm.planning_artifacts` as resolved inputs.
- A focused in-memory regression check proved a BMM/GDS collision selects BMM
  while a globally unique `core.output_folder` key still resolves normally.
- `python -m py_compile _bmad/scripts/render_skill.py` exited 0.

## Scope

Only the approved BMAD renderer and this task report changed. No application,
credentials, infrastructure, or deployment state was changed.
