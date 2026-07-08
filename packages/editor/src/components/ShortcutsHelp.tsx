import { SHORTCUTS } from '../shortcuts.js';

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-title">Keyboard Shortcuts</div>
        <table>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td className="keys">{s.keys}</td>
                <td>{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
