# Brings MCP

`@vectojs/brings-mcp` is a local-first Model Context Protocol server for
inspecting and changing Brings schema-v1 design documents. It exposes named
design intentions backed by `@vectojs/brings-core`; it does not provide a
generic command escape hatch, cloud sync, accounts, or collaboration.

## Run

The stdio server runs with Bun:

```bash
bun add --global @vectojs/brings-mcp
brings-mcp
```

Configure the command `brings-mcp` in an MCP client after installing the
package globally.

## Tools

| Tool                         | Intention                                         |
| ---------------------------- | ------------------------------------------------- |
| `brings_inspect_document`    | Validate and summarize one local document         |
| `brings_create_frame`        | Create a Frame at parent-local coordinates        |
| `brings_create_rectangle`    | Create a Rectangle at parent-local coordinates    |
| `brings_create_text`         | Create Text at parent-local coordinates           |
| `brings_set_node_properties` | Apply one compatible property patch               |
| `brings_transform_nodes`     | Apply one page-space affine transform             |
| `brings_delete_nodes`        | Delete selected subtrees atomically               |
| `brings_group_nodes`         | Group active-page sibling nodes                   |
| `brings_ungroup_node`        | Dissolve one Group while preserving geometry      |
| `brings_move_nodes`          | Reorder or reparent nodes at an exact layer index |

Mutation tools require `path` and an integer `expectedRevision` from zero
through `Number.MAX_SAFE_INTEGER`. They accept optional `dryRun`; create tools
return generated IDs so an Agent can replay a preview exactly. Creation
coordinates are parent-local, while transform deltas and scale origins are
page-space. Paint strings are exactly `#RRGGBB` or `#RRGGBBAA`; nullable paints
use explicit `null`.

Every successful or Core/filesystem-failed mutation returns the same JSON in
`structuredContent` and a text content block. The envelope reports the
operation, file, revision transition or conflict, affected/generated node IDs,
selection, and warnings. Protocol-level input-schema rejection remains an MCP
invalid-parameters response and does not invoke a document operation.

## Safe workflow

1. Call `brings_inspect_document` and capture `revision`.
2. Choose one named mutation tool and pass that revision.
3. Use `dryRun: true` when a preview is useful.
4. Replay every generated ID explicitly for the durable call.
5. Inspect again and verify the revision and affected nodes.

Mutations acquire `<file>.brings.lock`, reject symlinks, non-regular files and
multi-link files, validate through Core, execute one command, and atomically
replace the target. `document.revision-conflict` and `document.locked` never
change the file. Brings does not guess that a lock is stale; remove it only
after a human confirms the recorded process is gone.

If lock release fails after a committed replacement, the successful result
contains `document.lock-release-failed` in `warnings`. The document changed and
the sidecar lock needs manual recovery. Unix mode bits are preserved, while
ownership follows the process and ACLs or extended attributes are not
preserved.

## Development

```bash
bun install --frozen-lockfile
bun run verify
```

The integration suite uses the real MCP SDK stdio client and server transport.

## License

MIT
