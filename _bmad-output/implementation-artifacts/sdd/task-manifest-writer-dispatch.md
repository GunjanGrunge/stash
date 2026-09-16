# Dispatch Record: manifest lifecycle repair

| Field | Value |
|---|---|
| Host / harness | Codex |
| Subagent | `/root/manifest_writer` |
| Scope | Manifest Dynamo adapter and completed-Stash writer integration |
| Deploy | Explicitly excluded |
| Infrastructure / lockfile | Explicitly excluded |
| Status | In progress; design dependency escalated |

The task was dispatched after the user approved fixing the manifest writer.
The executor may move the provisional adapter into its owning manifest package,
but must not invent a selected folder identity absent from the current schema.
