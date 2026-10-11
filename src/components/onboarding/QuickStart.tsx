import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { quickStartFor } from '@/lib/quickstart';
import { useSettings } from '@/stores/settingsStore';

/** Shows a game's short guide the first time you open it. Turned off (or reset) in Settings. */
export function QuickStart({ guide }: { guide: string }) {
  const tipsOn = useSettings((s) => s.tipsOn);
  const seen = useSettings((s) => Boolean(s.tipsSeen[guide]));
  const markTipSeen = useSettings((s) => s.markTipSeen);
  const setTipsOn = useSettings((s) => s.setTipsOn);
  const content = quickStartFor(guide);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!content || !tipsOn || seen) return;
    // Let the game draw first, so the guide opens over something.
    const t = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(t);
  }, [content, tipsOn, seen]);

  if (!content) return null;
  const close = () => {
    setOpen(false);
    markTipSeen(guide);
  };
  return (
    <Modal open={open} onClose={close} title={content.title} className="max-w-md">
      <h2 className="font-display text-2xl font-bold text-ivory">{content.title}</h2>
      <ol className="mt-4 space-y-3">
        {content.steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed text-cream/90">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-500 text-xs font-bold text-ink-950" aria-hidden="true">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="text-xs text-muted underline hover:text-cream"
          onClick={() => {
            setTipsOn(false);
            close();
          }}
        >
          Don&apos;t show guides
        </button>
        <Button onClick={close} data-autofocus>
          Got it
        </Button>
      </div>
    </Modal>
  );
}
