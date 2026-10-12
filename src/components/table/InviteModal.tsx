import { useEffect, useState } from 'react';
import { PlayerLine } from '@/components/progress/bits';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { friendlyError } from '@/lib/errors';
import type { Loadout } from '@/lib/progress';
import { supabase } from '@/lib/supabase';
import { toast } from '@/stores/toastStore';

interface Friend {
  user_id: string;
  username: string;
  level: number;
  loadout: Loadout;
  online?: boolean;
}

/** Pick friends to invite to the table you are sitting at. They get a notification with a Join button. */
export function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSent(new Set());
    void supabase.rpc('friends_list').then(({ data, error }) => {
      if (error) toast.error(friendlyError(error));
      else setFriends(((data as { friends?: Friend[] })?.friends ?? []) as Friend[]);
    });
  }, [open]);

  const invite = async (f: Friend) => {
    setBusy(f.user_id);
    const { error } = await supabase.rpc('invite_friend', { p_user: f.user_id });
    setBusy(null);
    if (error) return toast.error(friendlyError(error));
    setSent((s) => new Set(s).add(f.user_id));
    toast.success(`Invite sent to ${f.username}`);
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite friends" className="max-w-md">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold text-ivory">Invite friends</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted">They get a notification with a button that brings them to this table.</p>
      {!friends ? (
        <p className="mt-4 text-sm text-muted">Loading your friends…</p>
      ) : friends.length === 0 ? (
        <div className="mt-4 text-sm text-cream/85">
          <p>You haven&apos;t added any friends yet.</p>
          <ButtonLink to="/friends" size="sm" variant="outline" className="mt-3">
            Find friends
          </ButtonLink>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-white/[0.06]">
          {friends.map((f) => (
            <li key={f.user_id} className="flex items-center justify-between gap-3 py-2.5">
              <PlayerLine username={f.username} level={f.level} loadout={f.loadout} online={f.online} />
              <Button size="sm" variant={sent.has(f.user_id) ? 'ghost' : 'gold'} disabled={sent.has(f.user_id)} loading={busy === f.user_id} onClick={() => void invite(f)}>
                {sent.has(f.user_id) ? 'Invited ✓' : 'Invite'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
