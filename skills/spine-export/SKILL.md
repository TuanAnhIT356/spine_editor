---
name: spine-export
description: Validate and export a Spine project to Spine JSON 4.2 via MCP tools, with a compatibility checklist. Use when asked to export, save, or ship a skeleton.
---

# Exporting Spine JSON

1. `validate_project` — fix every issue with severity "error" before export
   (dangling references will not load in runtimes). Warnings are judgement
   calls; read them.
2. `export_spine_json` — returns the JSON text (target format **4.2**). Fields
   equal to Spine defaults are omitted, matching official exports.
3. Write the JSON to a `.json` file for the user, or hand it back inline if
   they asked for the content.

## Compatibility checklist

- `skeleton.spine` is "4.2.x" — official runtimes check the major.minor.
- Call `export_atlas` for the texture atlas: it returns the libgdx `.atlas`
  text (deliver as `skeleton.atlas`) and the packed `skeleton.png`. Region
  names equal attachment names, so runtimes load the trio (json + atlas + png)
  directly. Requires the images to be imported in the editor session.
- Images also live in the editor project (IndexedDB / project file) — deliver
  source images if the user wants to re-edit later.
- Loading exported files in Spine Runtimes requires the user to hold a Spine
  license (their responsibility, not the editor's).

## Round-trip note

The editor parses its own exports losslessly. Files from other tools/versions
parse with warnings when the version differs from 4.2; rig data is normalized,
skins/animations are preserved verbatim.
