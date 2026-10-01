import { useState } from 'react';
import { KeyRound, AlertCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { findProjectByCode } from '../../project/projectService';

export function OpenByCodeDialog({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!code.trim()) {
      setError('Enter a save code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const doc = await findProjectByCode(code);
      onOpen(doc.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Open project"
      subtitle="Enter the project’s save code. You’ll find it in Project Settings."
      icon={<KeyRound />}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? <span className="spinner" /> : null} Open project
          </button>
        </>
      }
    >
      <label className="field-label">Save code</label>
      <input
        className="input lg code"
        value={code}
        placeholder="3D-XXXX-XXXX"
        maxLength={16}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setCode(e.target.value.toUpperCase());
          setError(null);
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {error && (
        <div className="field-error" role="alert">
          <AlertCircle size={13} /> {error}
        </div>
      )}
    </Modal>
  );
}
