import { useEditor, type SelectionItem } from '../../../state/store.js';
import {
  AnimationIcon,
  EventIcon,
  IkIcon,
  CurveIcon,
  PhysicsIcon,
  TransformIcon,
} from '../../icons.js';

const ICONS: Record<string, (p: { size?: number }) => React.JSX.Element> = {
  ik: IkIcon,
  transform: TransformIcon,
  path: CurveIcon,
  physics: PhysicsIcon,
  event: EventIcon,
  animation: AnimationIcon,
};

/** Read-only summary for kinds whose full editors arrive in Phase 16b. */
export function InfoDock({ item }: { item: SelectionItem }) {
  const revision = useEditor((s) => s.revision);
  void revision;
  const data = useEditor.getState().doc.data;
  const Icon = ICONS[item.kind] ?? IkIcon;
  let summary = '';
  if (item.kind === 'ik') {
    const c = data.ik.find((c) => c.name === item.name);
    if (c) summary = `target ${c.target} · bones ${c.bones.join(', ')} · mix ${c.mix}`;
  } else if (item.kind === 'transform') {
    const c = data.transform.find((c) => c.name === item.name);
    if (c) summary = `target ${c.target} · bones ${c.bones.join(', ')}`;
  } else if (item.kind === 'path') {
    const c = data.path.find((c) => c.name === item.name);
    if (c) summary = `target ${c.target} · bones ${c.bones.join(', ')}`;
  } else if (item.kind === 'physics') {
    const c = data.physics.find((c) => c.name === item.name);
    if (c) summary = `bone ${c.bone}`;
  } else if (item.kind === 'event') {
    const e = data.events[item.name];
    if (e) summary = [e.string, e.audio].filter(Boolean).join(' · ') || 'event';
  } else if (item.kind === 'animation') {
    const a = data.animations[item.name];
    if (a) summary = `${Object.keys(a.bones ?? {}).length} bone tracks`;
  }
  return (
    <div className="info-dock">
      <div className="info-dock-head">
        <Icon size={16} /> <b>{item.name}</b>
        <span className="info-kind">{item.kind}</span>
      </div>
      <div className="info-summary">{summary}</div>
      <div className="empty">Full editing for this type arrives in Phase 16b.</div>
    </div>
  );
}
