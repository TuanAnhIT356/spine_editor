import {
  CreateSkin,
  RemoveAnimation,
  RemoveEventDef,
  RemoveIkConstraint,
  RemovePathConstraint,
  RemovePhysicsConstraint,
  RemoveSkin,
  RemoveTransformConstraint,
  type Command,
} from '@spine-editor/core';
import { useCallback, useRef, useState } from 'react';
import { audioEngine } from '../audio/engine.js';
import { useServer } from '../server/api.js';
import { readFileAsDataUrl } from '../state/persistence.js';
import { primarySelection, uniqueName, useEditor, type AudioAsset } from '../state/store.js';
import {
  AnimationIcon,
  CurveIcon,
  EventIcon,
  IkIcon,
  PhysicsIcon,
  SkeletonIcon,
  TransformIcon,
} from './icons.js';
import { Resizer } from './Resizer.js';
import { ContextMenu, type MenuItem } from './tree/ContextMenu.js';
import { clickSelect } from './tree/tree-actions.js';
import { TreeRows } from './tree/TreeRows.js';
import { AnimationDock } from './tree/dock/AnimationDock.js';
import { BoneDock } from './tree/dock/BoneDock.js';
import { ConstraintDock } from './tree/dock/ConstraintDock.js';
import { EventDock } from './tree/dock/EventDock.js';
import { SlotDock } from './tree/dock/SlotDock.js';

type OpenMenu = (e: React.MouseEvent, items: MenuItem[]) => void;

/** Skin list: pick the active (rendered) skin, create/duplicate/remove skins. */
function SkinsSection() {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const activeSkin = useEditor((s) => s.activeSkin);
  void revision;
  const skins = doc.data.skins;
  if (skins.length === 0) return null;

  function onNewSkin(copyFrom?: string) {
    const state = useEditor.getState();
    const name = window.prompt(
      copyFrom ? `Duplicate skin "${copyFrom}" as` : 'Skin name',
      uniqueName('skin', (n) => state.doc.data.skins.some((s) => s.name === n)),
    );
    if (!name) return;
    if (state.execute(new CreateSkin(name.trim(), copyFrom))) state.setActiveSkin(name.trim());
  }

  return (
    <>
      <div className="panel-title">Skins</div>
      <div className="skins">
        {skins.map((skin) => (
          <label key={skin.name} className={`row ${activeSkin === skin.name ? 'selected' : ''}`}>
            <input
              type="radio"
              name="active-skin"
              checked={activeSkin === skin.name}
              onChange={() => useEditor.getState().setActiveSkin(skin.name)}
            />
            <span className="skin-name">{skin.name}</span>
            <span className="row-actions">
              <button title={`Duplicate "${skin.name}"`} onClick={() => onNewSkin(skin.name)}>
                ⧉
              </button>
              {skin.name !== 'default' && (
                <button
                  title="Remove skin"
                  onClick={() => {
                    const state = useEditor.getState();
                    if (state.execute(new RemoveSkin(skin.name)) && activeSkin === skin.name) {
                      state.setActiveSkin('default');
                    }
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          </label>
        ))}
        <button className="new-skin" onClick={() => onNewSkin()}>
          + New Skin
        </button>
      </div>
    </>
  );
}

const CONSTRAINT_GROUPS = [
  { kind: 'ik' as const, icon: IkIcon },
  { kind: 'transform' as const, icon: TransformIcon },
  { kind: 'path' as const, icon: CurveIcon },
  { kind: 'physics' as const, icon: PhysicsIcon },
];

function ConstraintsSection({ openMenu }: { openMenu: OpenMenu }) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  void revision;
  const names = {
    ik: doc.data.ik.map((c) => c.name),
    transform: doc.data.transform.map((c) => c.name),
    path: doc.data.path.map((c) => c.name),
    physics: doc.data.physics.map((c) => c.name),
  };
  const total = Object.values(names).reduce((n, list) => n + list.length, 0);
  if (total === 0) return null;
  return (
    <>
      <div className="panel-title">Constraints</div>
      {CONSTRAINT_GROUPS.map(({ kind, icon: Icon }) =>
        names[kind].map((name) => (
          <div
            key={`${kind}:${name}`}
            className={`row constraint ${
              selection.some((s) => s.kind === kind && s.name === name) ? 'selected' : ''
            }`}
            style={{ paddingLeft: 16 }}
            onClick={(e) => clickSelect(e, { kind, name })}
            onContextMenu={(e) =>
              openMenu(e, [
                {
                  label: 'Delete',
                  danger: true,
                  onClick: () => {
                    const cmd: Command =
                      kind === 'ik'
                        ? new RemoveIkConstraint(name)
                        : kind === 'transform'
                          ? new RemoveTransformConstraint(name)
                          : kind === 'path'
                            ? new RemovePathConstraint(name)
                            : new RemovePhysicsConstraint(name);
                    if (useEditor.getState().execute(cmd)) useEditor.getState().select(null);
                  },
                },
              ])
            }
          >
            <span className="type-icon">
              <Icon size={12} />
            </span>
            {name}
          </div>
        )),
      )}
    </>
  );
}

function EventsSection({ openMenu }: { openMenu: OpenMenu }) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  void revision;
  const names = Object.keys(doc.data.events);
  if (names.length === 0) return null;
  return (
    <>
      <div className="panel-title">Events</div>
      {names.map((name) => (
        <div
          key={name}
          className={`row event ${
            selection.some((s) => s.kind === 'event' && s.name === name) ? 'selected' : ''
          }`}
          style={{ paddingLeft: 16 }}
          onClick={(e) => clickSelect(e, { kind: 'event', name })}
          onContextMenu={(e) =>
            openMenu(e, [
              {
                label: 'Delete',
                danger: true,
                onClick: () => {
                  if (useEditor.getState().execute(new RemoveEventDef(name))) {
                    useEditor.getState().select(null);
                  }
                },
              },
            ])
          }
        >
          <span className="type-icon">
            <EventIcon size={12} />
          </span>
          {name}
        </div>
      ))}
    </>
  );
}

function AnimationsSection({ openMenu }: { openMenu: OpenMenu }) {
  const revision = useEditor((s) => s.revision);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  void revision;
  const names = Object.keys(doc.data.animations);
  if (names.length === 0) return null;
  return (
    <>
      <div className="panel-title">Animations</div>
      {names.map((name) => (
        <div
          key={name}
          className={`row animation ${
            selection.some((s) => s.kind === 'animation' && s.name === name) ? 'selected' : ''
          }`}
          style={{ paddingLeft: 16 }}
          title="Double-click to open in animate mode"
          onClick={(e) => clickSelect(e, { kind: 'animation', name })}
          onContextMenu={(e) =>
            openMenu(e, [
              {
                label: 'Open',
                onClick: () => {
                  useEditor.getState().setAnimation(name);
                  useEditor.getState().setMode('animate');
                },
              },
              {
                label: 'Delete',
                danger: true,
                onClick: () => {
                  const s = useEditor.getState();
                  if (s.anim.current === name) s.setAnimation(null);
                  if (s.execute(new RemoveAnimation(name))) s.select(null);
                },
              },
            ])
          }
          onDoubleClick={() => {
            useEditor.getState().setAnimation(name);
            useEditor.getState().setMode('animate');
          }}
        >
          <span className="type-icon">
            <AnimationIcon size={12} />
          </span>
          {name}
        </div>
      ))}
    </>
  );
}

function ImagesSection() {
  const revision = useEditor((s) => s.revision);
  const assets = useEditor((s) => s.assets);
  const selection = useEditor((s) => s.selection);
  void revision;
  const primary = primarySelection(selection);
  const selectedBone = primary?.kind === 'bone' ? primary.name : null;
  return (
    <>
      <div className="panel-title">Images</div>
      <div className="assets">
        {Object.values(assets).length === 0 && (
          <div className="empty">Import images, then attach them to a selected bone.</div>
        )}
        {Object.values(assets).map((asset) => (
          <div key={asset.name} className="asset-row">
            <img src={asset.dataUrl} alt={asset.name} />
            <span className="asset-name" title={`${asset.width}×${asset.height}`}>
              {asset.name}
            </span>
            <button
              disabled={!selectedBone}
              title={selectedBone ? `Attach to bone "${selectedBone}"` : 'Select a bone first'}
              onClick={() =>
                selectedBone && useEditor.getState().attachAsset(asset.name, selectedBone)
              }
            >
              Attach
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function AudioSection() {
  const audioAssets = useEditor((s) => s.audioAssets);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onImport(files: FileList | null) {
    if (!files || files.length === 0) return;
    const state = useEditor.getState();
    try {
      const next: AudioAsset[] = [];
      for (const file of Array.from(files)) {
        const dataUrl = await readFileAsDataUrl(file);
        const base = file.name.replace(/\.[^.]+$/, '') || 'audio';
        const name = uniqueName(
          base,
          (n) => n in state.audioAssets || next.some((a) => a.name === n),
        );
        next.push({ name, dataUrl });
      }
      state.addAudioAssets(next);
      for (const a of next) audioEngine.ensure(a.name, a.dataUrl);
    } catch (err) {
      state.setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <div className="panel-title">Audio</div>
      <div className="assets audio-assets">
        {Object.values(audioAssets).length === 0 && (
          <div className="empty">Import audio, then pick it on an event (Audio field).</div>
        )}
        {Object.values(audioAssets).map((asset) => (
          <div key={asset.name} className="asset-row">
            <span className="audio-icon">🔉</span>
            <span className="asset-name" title={asset.name}>
              {asset.name}
            </span>
            <button
              title="Preview"
              onClick={() => {
                audioEngine.ensure(asset.name, asset.dataUrl);
                audioEngine.play(asset.name);
              }}
            >
              ▶
            </button>
            <button
              title="Remove audio asset"
              onClick={() => {
                useEditor.getState().removeAudioAsset(asset.name);
                audioEngine.remove(asset.name);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button className="asset-import" onClick={() => inputRef.current?.click()}>
        Import Audio
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => {
          void onImport(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}

/** Spine-style unified panel: tree + sections above, properties dock below. */
export function TreePanel() {
  const layout = useEditor((s) => s.layout);
  const selection = useEditor((s) => s.selection);
  const [filter, setFilter] = useState('');
  const [show, setShow] = useState({ slots: true, attachments: true, constraints: true });
  const [dockHeight, setDockHeight] = useState(260);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const openMenu = useCallback<OpenMenu>((e, items) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);
  const primary = primarySelection(selection);
  const projectName = useServer((s) => s.projectName) || 'untitled';
  const extraCount = selection.length > 1 ? selection.length - 1 : 0;

  return (
    <div className="panel tree-panel" style={{ width: layout.propertiesWidth }}>
      <input
        className="tree-filter"
        placeholder="Search bones/slots…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="tree-chips">
        {(['slots', 'attachments', 'constraints'] as const).map((k) => (
          <button
            key={k}
            className={show[k] ? 'chip on' : 'chip'}
            onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
          >
            {k[0]!.toUpperCase() + k.slice(1)}
          </button>
        ))}
        {extraCount > 0 && <span className="selection-count">{selection.length} selected</span>}
      </div>
      <div className="tree">
        <div className="row skeleton-row">
          <span className="type-icon">
            <SkeletonIcon size={13} />
          </span>
          {projectName}
        </div>
        <TreeRows query={filter.trim().toLowerCase()} show={show} openMenu={openMenu} />
        {show.constraints && <ConstraintsSection openMenu={openMenu} />}
        <SkinsSection />
        <EventsSection openMenu={openMenu} />
        <AnimationsSection openMenu={openMenu} />
        <ImagesSection />
        <AudioSection />
      </div>
      <Resizer
        axis="y"
        onResize={(d) => setDockHeight((h) => Math.max(120, Math.min(600, h - d)))}
      />
      <div className="tree-dock" style={{ height: dockHeight }}>
        {!primary && <div className="empty">Select a bone or slot to edit its properties.</div>}
        {primary?.kind === 'bone' && <BoneDock name={primary.name} />}
        {primary?.kind === 'slot' && <SlotDock name={primary.name} />}
        {(primary?.kind === 'ik' ||
          primary?.kind === 'transform' ||
          primary?.kind === 'path' ||
          primary?.kind === 'physics') && (
          <ConstraintDock kind={primary.kind} name={primary.name} />
        )}
        {primary?.kind === 'event' && <EventDock name={primary.name} />}
        {primary?.kind === 'animation' && <AnimationDock name={primary.name} />}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
