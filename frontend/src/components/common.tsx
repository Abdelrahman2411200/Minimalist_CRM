import { useEffect, useId, useRef, type ReactNode, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CrmError } from '../data/errors';
import type { Stage } from '../data/types';

export function PageHeader({ title, children, back }: { title: string; children?: ReactNode; back?: { to: string; label: string } }) {
  return <>
    {back && <Link className="back-link" to={back.to}>← {back.label}</Link>}
    <div className="page-header"><h1>{title}</h1><div className="actions">{children}</div></div>
  </>;
}

export function Loading({ label = 'Loading records…' }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label}</div>;
}

export function Failure({ error, retry }: { error: Error; retry?: () => void }) {
  return <div className="error-panel" role="alert">
    <p>{error.message || 'The request failed. Please try again.'}</p>
    {retry && <button type="button" className="button secondary" onClick={retry}>Try again</button>}
    {error instanceof CrmError && error.status === 404 && <Link to="/contacts">Back to contacts</Link>}
  </div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><h2>{title}</h2>{children}</div>;
}

export function StageBadge({ stage }: { stage?: Stage }) {
  return stage ? <span className={`stage stage-${stage.toLowerCase().replaceAll(' ', '-')}`}>{stage}</span> : <span className="muted">No lead</span>;
}

export function Field({ label, name, error, children }: {
  label: string;
  name: string;
  error?: string;
  children: (attributes: { id: string; name: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode;
}) {
  const id = useId();
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    {children({ id, name, 'aria-invalid': Boolean(error), 'aria-describedby': error ? `${id}-error` : undefined })}
    {error && <span id={`${id}-error`} className="field-error">{error}</span>}
  </div>;
}

export function RecordForm({ children, error, pending, onSubmit, cancelTo, submitLabel }: {
  children: ReactNode;
  error: Error | null;
  pending: boolean;
  onSubmit: (values: FormData) => void;
  cancelTo: string;
  submitLabel: string;
}) {
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (error) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [error]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(new FormData(event.currentTarget));
  }
  return <form ref={form} className="record-form panel" noValidate onSubmit={submit}>
    {error && <Failure error={error} />}
    <fieldset disabled={pending}>
      <div className="form-grid">{children}</div>
      <div className="form-actions">
        <button type="submit" className="button" disabled={pending}>{pending ? 'Saving…' : submitLabel}</button>
        <button type="button" className="button secondary" onClick={() => navigate(cancelTo)} disabled={pending}>Cancel</button>
      </div>
    </fieldset>
  </form>;
}
