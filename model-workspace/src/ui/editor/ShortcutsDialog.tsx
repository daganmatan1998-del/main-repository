import { Keyboard } from 'lucide-react';
import { Modal } from '../common/Modal';

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
const GROUPS: [string, [string, string[]][]][] = [
  ['Transform', [['Move', ['W']], ['Rotate', ['E']], ['Scale', ['R']], ['Toggle world / local', ['X']], ['Toggle snapping', ['S']], ['Hold to snap while dragging', ['Shift']]]],
  ['Edit', [['Undo', [mod, 'Z']], ['Redo', [mod, '⇧', 'Z']], ['Duplicate', [mod, 'D']], ['Delete', ['Del']], ['Rename', ['F2']], ['Hide / show', ['H']], ['Lock / unlock', ['L']], ['Select all', [mod, 'A']], ['Deselect', ['Esc']]]],
  ['Tools', [['Command palette', [mod, 'K']], ['Measure distance', ['M']], ['Section plane', ['C']], ['Cycle view mode', ['V']], ['Isolate selection', ['I']], ['Turntable', ['T']], ['Capture image', ['P']], ['Hide / show panels', ['Tab']]]],
  ['Camera', [['Focus selected', ['F']], ['Fit scene', ['A']], ['Front / Back', ['1', '/', mod, '1']], ['Right / Left', ['3', '/', mod, '3']], ['Top / Bottom', ['7', '/', mod, '7']], ['Perspective / ortho', ['5']], ['Reset camera', ['Home']], ['Orbit', ['Left drag']], ['Pan', ['Right drag']], ['Zoom', ['Wheel']]]],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" icon={<Keyboard />} onClose={onClose} wide>
      <div className="shortcut-grid">
        {GROUPS.map(([g, rows]) => [
          <h4 key={g}>{g}</h4>,
          ...rows.map(([label, keys]) => [
            <span key={`${g}${label}k`} className="k">{label}</span>,
            <span key={`${g}${label}v`} className="v">{keys.map((k, i) => (k === '/' ? <span key={i} style={{ color: 'var(--text-4)' }}>/</span> : <kbd key={i}>{k}</kbd>))}</span>,
          ]),
        ])}
      </div>
    </Modal>
  );
}
