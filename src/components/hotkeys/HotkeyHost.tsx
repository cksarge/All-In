import { useEffect, useMemo, useRef } from 'react';
import { create } from 'zustand';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { hasHotkeys, hotkeysOn, keyLabel, keyName, listHotkeys, runHotkey, typingOrDialog } from '@/lib/hotkeys';
import { useSettings } from '@/stores/settingsStore';

const useKeysOpen = create<{ open: boolean; set: (open: boolean) => void }>()((set) => ({ open: false, set: (open) => set({ open }) }));

/** Mounted once: listens for shortcuts everywhere, and shows the list of them when "?" is pressed. */
export function HotkeyHost() {
  const { open, set } = useKeysOpen();
  // Read as the list opens, so its first frame is already right. While it fades out it keeps what it showed.
  const shown = useRef<{ key: string; label: string }[]>([]);
  const list = useMemo(() => (open ? (shown.current = listHotkeys()) : shown.current), [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyName(e) === '?' && hotkeysOn() && !typingOrDialog(e.target) && hasHotkeys()) {
        e.preventDefault();
        set(true);
        return;
      }
      runHotkey(e);
    };
    // A button clicked with the mouse keeps the keyboard's focus, and Space would press it again
    // (another chip on the same spot) instead of dealing. Let go of it; keyboard users are not affected.
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0 || !hotkeysOn() || !hasHotkeys()) return;
      const b = (e.target as HTMLElement | null)?.closest?.('button');
      if (b && !b.closest('[role="dialog"]') && document.activeElement === b) b.blur();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [set]);

  return (
    <Modal open={open} onClose={() => set(false)} title="Keyboard shortcuts" className="max-w-md">
      <h2 className="font-display text-2xl font-bold text-ivory">Keyboard shortcuts</h2>
      <p className="mt-1 text-sm text-muted">For this screen. Press ? at any time to see them.</p>
      <dl className="mt-4 grid max-h-[55dvh] grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 overflow-y-auto pr-1">
        {list.map((h) => (
          <div key={`${h.key}|${h.label}`} className="contents">
            <dt>
              <kbd className="inline-block min-w-8 rounded-md border border-white/20 bg-ink-950 px-2 py-1 text-center font-sans text-xs font-semibold text-gold-200">{keyLabel(h.key)}</kbd>
            </dt>
            <dd className="text-sm text-cream/90">{h.label}</dd>
          </div>
        ))}
      </dl>
      {list.length === 0 && <p className="mt-4 text-sm text-cream/85">This screen has no shortcuts.</p>}
      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">You can switch shortcuts off in Settings.</p>
        <Button size="sm" variant="outline" onClick={() => set(false)} data-autofocus>
          Close
        </Button>
      </div>
    </Modal>
  );
}

/** "Keys" in a game's header: opens the list. Not shown on phones, which have no keyboard. */
export function KeysButton() {
  const on = useSettings((s) => s.hotkeysOn);
  const open = useKeysOpen((s) => s.set);
  if (!on) return null;
  return (
    <Button size="sm" variant="ghost" className="max-md:hidden" title="Keyboard shortcuts (?)" onClick={() => open(true)}>
      Keys
    </Button>
  );
}
