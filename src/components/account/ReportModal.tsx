import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { toast } from '@/stores/toastStore';

const REASONS = [
  { key: 'name', label: 'Offensive username' },
  { key: 'cheating', label: 'Cheating or teaming up unfairly' },
  { key: 'harassment', label: 'Harassment' },
  { key: 'other', label: 'Something else' },
] as const;

/** Sends a report about a player to the moderator. */
export function ReportModal({ open, onClose, userId, username }: { open: boolean; onClose: () => void; userId: string; username: string }) {
  const [reason, setReason] = useState<string>('name');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('report_player', { p_user: userId, p_reason: reason, p_note: note.trim() || null });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    toast.success('Report sent', 'Thanks. A moderator will take a look.');
    setNote('');
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={`Report ${username}`} className="max-w-md">
      <h2 className="font-display text-2xl font-bold text-ivory">Report {username}</h2>
      <fieldset className="mt-4">
        <legend className="text-sm text-muted">What is wrong?</legend>
        <div className="mt-2 grid gap-2">
          {REASONS.map((r) => (
            <label
              key={r.key}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition',
                reason === r.key ? 'border-gold-500/60 bg-gold-500/10 text-ivory' : 'border-white/10 text-cream/85 hover:border-white/20',
              )}
            >
              <input type="radio" name="report-reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} className="accent-gold-500" />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 block text-sm text-muted" htmlFor="report-note">
        Anything the moderator should know (optional)
      </label>
      <textarea
        id="report-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={300}
        rows={3}
        className="mt-1.5 w-full rounded-xl border border-white/15 bg-ink-950 px-3 py-2 text-sm text-cream"
      />
      <p className="mt-1 text-xs text-muted">Only the moderator sees this. {username} is not told who reported them.</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={busy} onClick={() => void send()}>
          Send report
        </Button>
      </div>
    </Modal>
  );
}
