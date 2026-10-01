import { useState, type ReactNode } from 'react';
import { AlertTriangle, AlertCircle } from 'lucide-react';
import { Modal } from './Modal';

export function ConfirmDialog(props: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  icon?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={props.title}
      subtitle={props.message}
      icon={props.icon ?? <AlertTriangle />}
      tone={props.tone}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.onClose}>Cancel</button>
          <button
            data-autofocus
            className={`btn ${props.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {props.confirmLabel}
          </button>
        </>
      }
    />
  );
}

export function PromptDialog(props: {
  title: string;
  subtitle?: ReactNode;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel: string;
  icon?: ReactNode;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(props.initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!value.trim()) {
      setError('Please enter a name.');
      return;
    }
    setBusy(true);
    try {
      await props.onSubmit(value.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={props.title}
      subtitle={props.subtitle}
      icon={props.icon}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>{props.confirmLabel}</button>
        </>
      }
    >
      <label className="field-label">{props.label}</label>
      <input
        className="input lg"
        value={value}
        maxLength={80}
        placeholder={props.placeholder}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {error && (
        <div className="field-error">
          <AlertCircle size={13} /> {error}
        </div>
      )}
    </Modal>
  );
}
