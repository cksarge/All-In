import type { ReactNode } from 'react';
import { Modal } from '@/components/ui/Modal';

/** Modal with a title bar and close button, used for rules and history panels. */
export function InfoModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} className="max-h-[90dvh] max-w-xl overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold text-ivory">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:text-ivory">
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {children}
    </Modal>
  );
}

export function TabButtons<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: [T, string][];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div role="tablist" className="mt-4 flex flex-wrap gap-1.5">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={
            value === k
              ? 'rounded-full border border-gold-500/60 bg-gold-500/15 px-3 py-1.5 text-sm text-gold-200'
              : 'rounded-full border border-white/10 px-3 py-1.5 text-sm text-cream/75 transition hover:text-ivory'
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
