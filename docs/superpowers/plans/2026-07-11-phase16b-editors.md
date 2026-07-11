# Phase 16b — Editors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full editing for every tree selection: 4 undoable constraint-patch commands (+SetBoneColor) power Spine-style dock forms for ik/transform/path/physics/event/animation, exposed as 4 new MCP tools (55→59), plus right-click context menus and inline rename for bones/animations.

**Architecture:** Core gains patch commands that snapshot-and-restore the touched constraint (validate-then-mutate like the Add\* commands). The bridge/MCP layer picks them up via TOOL_DEFS (single source). The editor dock replaces InfoDock with real forms driven by those commands; a shared ContextMenu component and an inline-rename row state finish the tree UX.

**Tech Stack:** core Command pattern + vitest, zod TOOL_DEFS, React dock forms, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-07-11-phase16b-editors-design.md`

## Global Constraints

- Branch `claude/phase16b-editors`; pnpm from `client/` (shim PATH `/private/tmp/claude-501/-Users-tuananh-Projects-you-spine-editor/6b990f26-97bc-4e20-b105-3db5aab338c5/scratchpad/bin`).
- ik/transform constraints live in MODEL types (`data.ik`/`data.transform`, all fields required); path/physics live as VERBATIM Spine JSON shapes (`data.path`/`data.physics`, fields optional) — patches must respect that.
- Patch commands: undo restores a `structuredClone` snapshot of the whole constraint taken at execute-time.
- `SetBoneColor` color = 8-hex RGBA or undefined (clears).
- toolCount moves 55→**59** (bridge.mjs expectation updated in the same task the defs land? No — defs land in Task 2 together with the bridge.mjs expectation + probe so every commit stays green).
- Every commit ends with the repo trailer.

---

### Task 1: Core patch commands + tests (TDD)

**Files:**

- Modify: `client/packages/core/src/commands/constraints.ts` (4 classes appended)
- Modify: `client/packages/core/src/commands/bones.ts` (SetBoneColor)
- Test: `client/packages/core/test/constraints-set.test.ts` (new)

**Interfaces (Produces):**

```ts
export class SetIkConstraintProperties implements Command {
  constructor(name: string, patch: Partial<Omit<IkConstraintData, 'name'>>);
}
export class SetTransformConstraintProperties implements Command {
  constructor(name: string, patch: Partial<Omit<TransformConstraintData, 'name'>>);
}
export class SetPathConstraintProperties implements Command {
  constructor(name: string, patch: Partial<Omit<SpinePathConstraint, 'name'>>);
}
export class SetPhysicsConstraintProperties implements Command {
  constructor(name: string, patch: Partial<Omit<SpinePhysicsConstraint, 'name'>>);
}
export class SetBoneColor implements Command {
  constructor(name: string, color: string | undefined);
}
```

- [ ] **Step 1: failing tests** — create `client/packages/core/test/constraints-set.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AddBone,
  AddIkConstraint,
  AddPathConstraint,
  AddPhysicsConstraint,
  AddSlot,
  AddTransformConstraint,
  SetBoneColor,
  SetIkConstraintProperties,
  SetPathConstraintProperties,
  SetPhysicsConstraintProperties,
  SetTransformConstraintProperties,
  SpineDocument,
  createBone,
  createSlot,
} from '../src/index.js';

function rig() {
  const doc = new SpineDocument();
  doc.history.execute(new AddBone(createBone('a', 'root', {})), doc.data);
  doc.history.execute(new AddBone(createBone('b', 'root', {})), doc.data);
  doc.history.execute(new AddBone(createBone('t', 'root', {})), doc.data);
  doc.history.execute(new AddSlot(createSlot('s', 'a')), doc.data);
  return doc;
}

describe('constraint property patches', () => {
  it('patches IK fields, undoes, and validates targets', () => {
    const doc = rig();
    doc.history.execute(
      new AddIkConstraint({
        name: 'ik1',
        order: 0,
        skinRequired: false,
        bones: ['a'],
        target: 't',
        mix: 1,
        softness: 0,
        bendPositive: true,
        compress: false,
        stretch: false,
        uniform: false,
      }),
      doc.data,
    );
    doc.history.execute(
      new SetIkConstraintProperties('ik1', { mix: 0.5, stretch: true }),
      doc.data,
    );
    expect(doc.data.ik[0]!.mix).toBe(0.5);
    expect(doc.data.ik[0]!.stretch).toBe(true);
    doc.history.undo(doc.data);
    expect(doc.data.ik[0]!.mix).toBe(1);
    expect(doc.data.ik[0]!.stretch).toBe(false);
    expect(() =>
      doc.history.execute(new SetIkConstraintProperties('ik1', { target: 'nope' }), doc.data),
    ).toThrow(/does not exist/);
    expect(() =>
      doc.history.execute(new SetIkConstraintProperties('missing', { mix: 0 }), doc.data),
    ).toThrow(/does not exist/);
  });

  it('patches transform mixes with bone validation', () => {
    const doc = rig();
    doc.history.execute(
      new AddTransformConstraint({
        name: 'tc',
        order: 0,
        skinRequired: false,
        bones: ['a'],
        target: 't',
        rotation: 0,
        x: 0,
        y: 0,
        scaleX: 0,
        scaleY: 0,
        shearY: 0,
        mixRotate: 1,
        mixX: 1,
        mixY: 1,
        mixScaleX: 1,
        mixScaleY: 1,
        mixShearY: 1,
        local: false,
        relative: false,
      }),
      doc.data,
    );
    doc.history.execute(
      new SetTransformConstraintProperties('tc', { mixRotate: 0.25, x: 10 }),
      doc.data,
    );
    expect(doc.data.transform[0]!.mixRotate).toBe(0.25);
    expect(doc.data.transform[0]!.x).toBe(10);
    doc.history.undo(doc.data);
    expect(doc.data.transform[0]!.mixRotate).toBe(1);
  });

  it('patches path constraint (verbatim shape) and validates slot target', () => {
    const doc = rig();
    doc.history.execute(new AddPathConstraint({ name: 'pc', bones: ['a'], target: 's' }), doc.data);
    doc.history.execute(
      new SetPathConstraintProperties('pc', { position: 0.5, rotateMode: 'chain' }),
      doc.data,
    );
    expect(doc.data.path[0]!.position).toBe(0.5);
    expect(doc.data.path[0]!.rotateMode).toBe('chain');
    doc.history.undo(doc.data);
    expect(doc.data.path[0]!.position).toBeUndefined();
    expect(() =>
      doc.history.execute(new SetPathConstraintProperties('pc', { target: 'no-slot' }), doc.data),
    ).toThrow(/does not exist/);
  });

  it('patches physics constraint fields', () => {
    const doc = rig();
    doc.history.execute(new AddPhysicsConstraint({ name: 'ph', bone: 'a', rotate: 1 }), doc.data);
    doc.history.execute(
      new SetPhysicsConstraintProperties('ph', { gravity: 5, damping: 0.8 }),
      doc.data,
    );
    expect(doc.data.physics[0]!.gravity).toBe(5);
    doc.history.undo(doc.data);
    expect(doc.data.physics[0]!.gravity).toBeUndefined();
  });

  it('sets and clears bone color with validation', () => {
    const doc = rig();
    doc.history.execute(new SetBoneColor('a', 'ff8800ff'), doc.data);
    expect(doc.data.bones.find((b) => b.name === 'a')!.color).toBe('ff8800ff');
    doc.history.undo(doc.data);
    expect(doc.data.bones.find((b) => b.name === 'a')!.color).toBeUndefined();
    expect(() => doc.history.execute(new SetBoneColor('a', 'xyz'), doc.data)).toThrow(/RGBA/);
  });
});
```

Check the REAL execute/undo call shape first: existing tests use `doc.history.execute(cmd, doc.data)`? Read `client/packages/core/test/constraints-remove.test.ts` and mirror its helpers exactly (it already builds rigs with constraints); the `AddPathConstraint`/`AddPhysicsConstraint` argument shapes above must match those used there (path target slot creation included). Adjust the test to the established idiom before running.

- [ ] **Step 2: RED** — `pnpm --filter @spine-editor/core test -- test/constraints-set.test.ts` → import errors.

- [ ] **Step 3: implement** — append to `constraints.ts` (pattern for all four; ik shown, others identical with their array/type and extra validation):

```ts
/** Patches fields of an existing IK constraint (undo restores the snapshot). */
export class SetIkConstraintProperties implements Command {
  readonly label: string;
  private previous: IkConstraintData | null = null;

  constructor(
    private readonly name: string,
    private readonly patch: Partial<Omit<IkConstraintData, 'name'>>,
  ) {
    this.label = `Edit IK constraint "${name}"`;
  }

  execute(data: SkeletonData): void {
    const c = data.ik.find((x) => x.name === this.name);
    if (!c) throw new Error(`IK constraint "${this.name}" does not exist.`);
    const bones = this.patch.bones ?? c.bones;
    if (bones.length < 1 || bones.length > 2) {
      throw new Error('IK constraints require 1 or 2 bones.');
    }
    for (const bone of [...bones, this.patch.target ?? c.target]) {
      if (!data.bones.some((b) => b.name === bone)) {
        throw new Error(`Bone "${bone}" does not exist.`);
      }
    }
    this.previous = structuredClone(c);
    Object.assign(c, structuredClone(this.patch));
  }

  undo(data: SkeletonData): void {
    const idx = data.ik.findIndex((x) => x.name === this.name);
    if (idx >= 0 && this.previous) data.ik[idx] = structuredClone(this.previous);
  }
}
```

- `SetTransformConstraintProperties`: same over `data.transform`, bones length ≥1, validate patched `bones`/`target` as bones.
- `SetPathConstraintProperties`: over `data.path` (`SpinePathConstraint`); validate patched `bones` exist as bones and patched `target` exists as a SLOT (`data.slots.some(...)`). NOTE verbatim shape: `Object.assign` with clone of patch; undo restores snapshot (so keys that were absent return to absent — snapshot replace handles it).
- `SetPhysicsConstraintProperties`: over `data.physics` (`SpinePhysicsConstraint`); validate patched `bone` exists.
- `bones.ts` — append:

```ts
/** Sets or clears a bone's tree color (8-hex RGBA, e.g. "ff8800ff"). */
export class SetBoneColor implements Command {
  readonly label: string;
  private previous: string | undefined;

  constructor(
    private readonly name: string,
    private readonly color: string | undefined,
  ) {
    this.label = `Color bone "${name}"`;
  }

  execute(data: SkeletonData): void {
    if (this.color !== undefined && !/^[0-9a-fA-F]{8}$/.test(this.color)) {
      throw new Error('Bone color must be 8-hex RGBA (e.g. "ff8800ff").');
    }
    const bone = data.bones.find((b) => b.name === this.name);
    if (!bone) throw new Error(`Bone "${this.name}" does not exist.`);
    this.previous = bone.color;
    if (this.color === undefined) delete bone.color;
    else bone.color = this.color;
  }

  undo(data: SkeletonData): void {
    const bone = data.bones.find((b) => b.name === this.name);
    if (!bone) return;
    if (this.previous === undefined) delete bone.color;
    else bone.color = this.previous;
  }
}
```

- [ ] **Step 4: GREEN** — new file passes; full `pnpm --filter @spine-editor/core test` + `pnpm typecheck`.
- [ ] **Step 5: commit** — `P16b: constraint property patch commands + SetBoneColor`

---

### Task 2: Bridge ops + TOOL_DEFS 59 + bridge.mjs probe

**Files:**

- Modify: `client/packages/shared/src/index.ts` (BRIDGE_OPS +4 after `'remove_physics_constraint'`)
- Modify: `client/packages/editor/src/bridge/ops.ts` (4 cases + imports)
- Modify: `client/packages/shared/src/tools.ts` (4 defs after the remove\_\* defs)
- Modify: `client/packages/shared/test/tools.test.ts` (55→59)
- Modify: `client/packages/mcp-server/e2e/bridge.mjs` (toolCount 59 + setIk probe)
- Modify: `skills/spine-rigging/SKILL.md` (one line)

- [ ] **Step 1:** shared test expectations 55→59 (`toHaveLength(59)`, `size).toBe(59)`, schemas length 59) → RED.
- [ ] **Step 2:** BRIDGE_OPS: insert `'set_ik_constraint', 'set_transform_constraint', 'set_path_constraint', 'set_physics_constraint',` after `'remove_physics_constraint',`.
- [ ] **Step 3:** ops.ts — import the 4 new command classes; add after the `remove_physics_constraint` case (patch = every param except name, dropped when undefined):

```ts
    case 'set_ik_constraint':
    case 'set_transform_constraint':
    case 'set_path_constraint':
    case 'set_physics_constraint': {
      const name = str(params, 'name');
      const patch = Object.fromEntries(
        Object.entries(params).filter(([k, v]) => k !== 'name' && v !== undefined),
      );
      const command =
        knownOp === 'set_ik_constraint'
          ? new SetIkConstraintProperties(name, patch)
          : knownOp === 'set_transform_constraint'
            ? new SetTransformConstraintProperties(name, patch)
            : knownOp === 'set_path_constraint'
              ? new SetPathConstraintProperties(name, patch)
              : new SetPhysicsConstraintProperties(name, patch);
      executeOrThrow(command);
      return { ok: true };
    }
```

(Cast `patch` as needed to satisfy the four Partial types — a single `as never`-free cast per constructor argument is fine, e.g. build `const p = patch as Record<string, unknown>` and pass `p` with a targeted cast per branch.)

- [ ] **Step 4:** TOOL_DEFS — after the four `remove_*_constraint` defs insert four `def(...)` entries: name = op; description e.g. `'Patch an existing IK constraint in place (only the fields you pass change; undoable): target, bones, mix, softness, bendPositive, compress, stretch.'`; shape = the corresponding `add_*_constraint` shape with EVERY field `.optional()` except `name: z.string()` (copy each shape from the add\_\* def above it and add `.optional()` where missing).
- [ ] **Step 5:** bridge.mjs — change the summary `toolCount` consumer? (toolCount is just reported; the FINAL acceptance greps it). Add after the constraint removal round-trip block:

```js
await call('set_ik_constraint', { name: 'arm-ik', mix: 0.5 });
const ikAfterSet = (await call('get_skeleton_tree')).ik ?? [];
```

and summary field: `setIkWorks: ikAfterSet.some((c) => c.name === 'arm-ik' && c.mix === 0.5),`. NOTE ordering: the removal probe removes + undoes `arm-ik`, so it exists again here.

- [ ] **Step 6:** skills/spine-rigging: extend the remove\_\* sentence with `— or tweak one in place with set_{ik,transform,path,physics}_constraint (patch semantics, undoable)`.
- [ ] **Step 7:** GREEN: shared tests (3 tests, 59), typecheck, mcp unit tests. Commit `P16b: set_*_constraint ops + tools (59 tools)`.

---

### Task 3: Dock editors (Constraint/Event/Animation) + Bone color, delete InfoDock

**Files:**

- Create: `client/packages/editor/src/components/tree/dock/ConstraintDock.tsx`
- Create: `client/packages/editor/src/components/tree/dock/EventDock.tsx`
- Create: `client/packages/editor/src/components/tree/dock/AnimationDock.tsx`
- Modify: `client/packages/editor/src/components/tree/dock/BoneDock.tsx` (Color row)
- Delete: `client/packages/editor/src/components/tree/dock/InfoDock.tsx`
- Modify: `client/packages/editor/src/components/TreePanel.tsx` (routing)

**Interfaces:** `ConstraintDock({ kind, name }: { kind: 'ik' | 'transform' | 'path' | 'physics'; name: string })`; `EventDock({ name })`; `AnimationDock({ name })`.

- [ ] **Step 1: ConstraintDock** — one file, four small forms sharing helpers. Skeleton (write in full; IK form shown, mirror the field lists from the spec for the other three):

```tsx
import {
  RemoveIkConstraint,
  RemovePathConstraint,
  RemovePhysicsConstraint,
  RemoveTransformConstraint,
  SetIkConstraintProperties,
  SetPathConstraintProperties,
  SetPhysicsConstraintProperties,
  SetTransformConstraintProperties,
} from '@spine-editor/core';
import { useEditor } from '../../../state/store.js';
import { NumField } from './fields.js';

function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function BoneSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const doc = useEditor((s) => s.doc);
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {doc.data.bones.map((b) => (
          <option key={b.name} value={b.name}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ConstraintDock({
  kind,
  name,
}: {
  kind: 'ik' | 'transform' | 'path' | 'physics';
  name: string;
}) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  void revision;
  const exec = (cmd: Parameters<ReturnType<typeof useEditor.getState>['execute']>[0]) =>
    useEditor.getState().execute(cmd);
  const del = (cmd: Parameters<typeof exec>[0]) => {
    if (exec(cmd)) useEditor.getState().select(null);
  };

  if (kind === 'ik') {
    const c = doc.data.ik.find((x) => x.name === name);
    if (!c) return null;
    const patch = (p: Partial<typeof c>) => exec(new SetIkConstraintProperties(name, p));
    return (
      <>
        <div className="panel-title">IK Constraint: {name}</div>
        <BoneSelect label="Target" value={c.target} onChange={(target) => patch({ target })} />
        <label className="field">
          <span>Bones</span>
          <input value={c.bones.join(', ')} disabled />
        </label>
        <Check
          label="Positive"
          value={c.bendPositive}
          onChange={(bendPositive) => patch({ bendPositive })}
        />
        <Check label="Stretch" value={c.stretch} onChange={(stretch) => patch({ stretch })} />
        <Check label="Compress" value={c.compress} onChange={(compress) => patch({ compress })} />
        <NumField
          label="Softness"
          value={c.softness}
          onCommit={(softness) => patch({ softness })}
        />
        <NumField label="Mix" value={c.mix} onCommit={(mix) => patch({ mix })} />
        <button className="danger" onClick={() => del(new RemoveIkConstraint(name))}>
          Delete Constraint
        </button>
      </>
    );
  }
  // transform / path / physics forms follow the same pattern with the exact
  // field lists from the spec §3 (transform: BoneSelect target + NumFields
  // rotation,x,y,scaleX,scaleY + mixes ×5 + Check local/relative; path:
  // slot select (doc.data.slots) + 3 mode <select>s + NumFields position,
  // spacing, rotation, mixRotate, mixX, mixY; physics: readonly bone +
  // NumFields x,y,rotate,scaleX,shearX,inertia,strength,damping,mass,wind,
  // gravity,limit,mix). Verbatim-shape constraints (path/physics) read
  // values with `?? default` (position ?? 0, mix ?? 1, …).
}
```

Write the remaining three branches as REAL JSX (the comment lists every field; defaults for verbatim shapes: numbers `?? 0` except `mix ?? 1`, `strength ?? 100`, `damping ?? 1`, `mass ?? 1`, `inertia ?? 1`, `limit ?? 5000`, modes `?? 'percent'/'length'/'tangent'`; check `SpinePhysicsConstraint`/`SpinePathConstraint` types for the exact optional keys while implementing).

- [ ] **Step 2: EventDock** (full):

```tsx
import { RemoveEventDef, SetEventDef } from '@spine-editor/core';
import { useEditor } from '../../../state/store.js';
import { NumField } from './fields.js';

export function EventDock({ name }: { name: string }) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  void revision;
  const def = doc.data.events[name];
  if (!def) return null;
  const patch = (p: Partial<typeof def>) =>
    useEditor.getState().execute(new SetEventDef(name, { ...def, ...p }));
  return (
    <>
      <div className="panel-title">Event: {name}</div>
      <NumField label="Int" value={def.int ?? 0} onCommit={(int) => patch({ int })} />
      <NumField label="Float" value={def.float ?? 0} onCommit={(float) => patch({ float })} />
      <label className="field">
        <span>String</span>
        <input
          defaultValue={def.string ?? ''}
          onBlur={(e) => patch({ string: e.target.value || undefined })}
        />
      </label>
      <label className="field">
        <span>Audio</span>
        <input
          defaultValue={def.audio ?? ''}
          onBlur={(e) => patch({ audio: e.target.value || undefined })}
        />
      </label>
      <NumField label="Volume" value={def.volume ?? 1} onCommit={(volume) => patch({ volume })} />
      <NumField
        label="Balance"
        value={def.balance ?? 0}
        onCommit={(balance) => patch({ balance })}
      />
      <button
        className="danger"
        onClick={() => {
          if (useEditor.getState().execute(new RemoveEventDef(name)))
            useEditor.getState().select(null);
        }}
      >
        Delete Event
      </button>
    </>
  );
}
```

Check `SetEventDef`'s constructor signature (name+def vs def-with-name) and `RemoveEventDef`'s before writing — mirror `events.ts`.

- [ ] **Step 3: AnimationDock** (full):

```tsx
import { RemoveAnimation, RenameAnimation } from '@spine-editor/core';
import { useEffect, useState } from 'react';
import { useEditor } from '../../../state/store.js';

export function AnimationDock({ name }: { name: string }) {
  const revision = useEditor((s) => s.revision);
  const anim = useEditor((s) => s.anim);
  void revision;
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  const commitRename = () => {
    const to = text.trim();
    if (!to || to === name) return setText(name);
    const s = useEditor.getState();
    if (s.execute(new RenameAnimation(name, to))) {
      if (s.anim.current === name) s.setAnimation(to);
      s.select({ kind: 'animation', name: to });
    } else setText(name);
  };
  return (
    <>
      <div className="panel-title">Animation</div>
      <label className="field">
        <span>Name</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <button
        onClick={() => {
          useEditor.getState().setAnimation(name);
          useEditor.getState().setMode('animate');
        }}
      >
        Open in Animate
      </button>
      <button
        className="danger"
        onClick={() => {
          const s = useEditor.getState();
          if (s.anim.current === name) s.setAnimation(null);
          if (s.execute(new RemoveAnimation(name))) s.select(null);
        }}
      >
        Delete Animation
      </button>
    </>
  );
}
```

Verify `RenameAnimation(from, to)` constructor order in `animations.ts`.

- [ ] **Step 4: BoneDock color row** — after the Length NumField:

```tsx
<label className="field">
  <span>Color</span>
  <input
    type="color"
    value={`#${(bone.color ?? 'e8a13cff').slice(0, 6)}`}
    onChange={(e) =>
      useEditor.getState().execute(new SetBoneColor(name, `${e.target.value.slice(1)}ff`))
    }
  />
  {bone.color && (
    <button
      title="Clear color"
      onClick={() => useEditor.getState().execute(new SetBoneColor(name, undefined))}
    >
      ✕
    </button>
  )}
</label>
```

(+ import `SetBoneColor`.)

- [ ] **Step 5: routing** — TreePanel dock area:

```tsx
{
  primary?.kind === 'bone' && <BoneDock name={primary.name} />;
}
{
  primary?.kind === 'slot' && <SlotDock name={primary.name} />;
}
{
  (primary?.kind === 'ik' ||
    primary?.kind === 'transform' ||
    primary?.kind === 'path' ||
    primary?.kind === 'physics') && <ConstraintDock kind={primary.kind} name={primary.name} />;
}
{
  primary?.kind === 'event' && <EventDock name={primary.name} />;
}
{
  primary?.kind === 'animation' && <AnimationDock name={primary.name} />;
}
```

`git rm` InfoDock.tsx; remove its import.

- [ ] **Step 6:** typecheck/build/lint/format; commit `P16b: dock editors for constraints, events, animations + bone color`.

---

### Task 4: Context menu + inline rename

**Files:**

- Create: `client/packages/editor/src/components/tree/ContextMenu.tsx`
- Modify: `client/packages/editor/src/components/tree/TreeRows.tsx` (bone rows: menu + inline rename)
- Modify: `client/packages/editor/src/components/TreePanel.tsx` (sections rows: menu; animations inline rename)
- Modify: `client/packages/editor/src/styles.css`

- [ ] **Step 1: ContextMenu** (full):

```tsx
import { useEffect } from 'react';

export interface MenuItem {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

/** Fixed-position right-click menu; closes on outside click or Escape. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <button
          key={it.label}
          className={it.danger ? 'danger' : ''}
          onClick={() => {
            it.onClick();
            onClose();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: TreePanel menu state** — `const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);` rendered last: `{menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}`. Pass `openMenu = (e, items) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items }); }` down to TreeRows via prop and use in sections.
- [ ] **Step 3: menu items per kind** —
  - bone row `onContextMenu`: `New Child Bone` (`AddBone(createBone(uniqueName('bone', exists), name, {}))` + select), `Rename` (start inline rename), `Delete` (RemoveBone + select(null)) — root: only New Child Bone.
  - slot row: `Delete Slot` (removeSlotCascade).
  - constraint rows (TreePanel ConstraintsSection): `Delete` via the matching Remove\* command.
  - event rows: `Delete` (RemoveEventDef).
  - animation rows: `Open`, `Rename` (inline), `Delete` (RemoveAnimation, clearing anim.current as in AnimationDock).
- [ ] **Step 4: inline rename** — in TreeRows: `const [renaming, setRenaming] = useState<string | null>(null);` bone row shows `<input autoFocus defaultValue={name} …commit via RenameBone>` instead of the label when `renaming === name`; trigger on double-click and F2 (row `tabIndex={0}` + `onKeyDown`), commit on Enter/blur, Escape cancels. Same pattern for animation rows in TreePanel (RenameAnimation + sync anim.current).
- [ ] **Step 5: styles** —

```css
.context-menu {
  position: fixed;
  z-index: 50;
  min-width: 150px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.context-menu button {
  text-align: left;
}
.context-menu button.danger {
  color: #e07a7a;
}
.rename-input {
  font-size: 12px;
  width: 120px;
}
```

- [ ] **Step 6:** typecheck/build/lint/format; manual dev check (right-click bone → New Child Bone; F2 rename); commit `P16b: tree context menus + inline rename (bones, animations)`.

---

### Task 5: e2e battery + docs

- [ ] **Step 1:** full battery per the Phase 15/16a recipe: build, vite preview :4173, smoke/anim; kill 8017 then bridge.mjs (expect **toolCount: 59**, `setIkWorks: true`, all prior flags); server CHAT_FAKE+SEGMENT_FAKE then chat.mjs (`chatRigWorks: true` — hello now carries 59 schemas).
- [ ] **Step 2:** screenshot: select `arm-ik` in the tree (bridge run leaves state? use smoke output instead — select the IK created in dev-server manual check, or extend the smoke screenshot review to the ConstraintDock via a quick manual/devtools check) — acceptance is the IK form fields matching Spine screenshot #3 (Target/Positive/Stretch/Softness/Mix).
- [ ] **Step 3:** suites + pytest; CLAUDE.md: replace the `Next: Phase 16b …` tail with `Phase 16b done: constraint/event/animation dock editors driven by new core patch commands (Set*ConstraintProperties, SetBoneColor), set_*_constraint MCP tools (59 total), tree context menus + inline rename. Phase 16 complete — next: PLAN.md §8 phases 17–22.`; PLAN.md §8 row 16: `✅ (07/2026, cả 16a+16b)`; also bump the two `55 MCP tools total`/`55 tools` mentions in CLAUDE.md to 59.
- [ ] **Step 4:** commit `P16b: e2e (59 tools, setIkWorks) + docs — Phase 16 complete`.

---

### Final acceptance (spec §5)

- [ ] Core tests new file green; suites + pytest green (§5.1)
- [ ] bridge.mjs `toolCount: 59` + `setIkWorks: true` (§5.2)
- [ ] smoke/anim/chat green (§5.3)
- [ ] IK dock form matches the Spine panel fields (§5.4 — screenshot/manual)
- [ ] Context menu + F2 rename work (§5.5 — manual dev check)
