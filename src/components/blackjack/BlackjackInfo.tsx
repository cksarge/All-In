import { useEffect, useState } from 'react';
import { CardFan } from '@/components/cards/PlayingCard';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type Tab = 'how' | 'payouts' | 'keys';

export function BlackjackRulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('how');
  return (
    <Modal open={open} onClose={onClose} title="Blackjack rules" className="max-h-[90dvh] max-w-xl overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold text-ivory">Blackjack</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:text-ivory">
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div role="tablist" className="mt-4 flex gap-1.5">
        {(
          [
            ['how', 'How to play'],
            ['payouts', 'Payouts & odds'],
            ['keys', 'Shortcuts'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition',
              tab === k ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:text-ivory',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'how' && (
        <div className="mt-5 space-y-4 text-sm leading-relaxed text-cream/85">
          <p>
            <strong className="text-ivory">Goal:</strong> finish closer to 21 than the dealer without going over. You
            play against the dealer, not the other players.
          </p>
          <div className="flex items-center gap-4">
            <CardFan cards={[0, 12]} size="sm" />
            <p>
              Cards 2–10 count their number, J/Q/K count 10, and an Ace counts 1 or 11. An Ace + a ten-card on your
              first two cards is a <strong className="text-gold-200">blackjack</strong>.
            </p>
          </div>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Place a bet during the betting window. The hand deals when everyone is in, or when the timer ends.</li>
            <li>You and the dealer get two cards. One dealer card stays face down.</li>
            <li>On your turn, choose an action before your timer runs out (if it does, you stand).</li>
            <li>The dealer then reveals and draws until reaching 17 or more.</li>
          </ol>
          <dl className="grid gap-2 sm:grid-cols-2">
            {[
              ['Hit', 'Take another card.'],
              ['Stand', 'Keep your total.'],
              ['Double', 'Double your bet, take exactly one more card.'],
              ['Split', 'Two cards of the same value become two hands (up to 3 hands).'],
              ['Surrender', 'Give up your first two cards and get half your bet back.'],
              ['Insurance', 'When the dealer shows an Ace, bet half your bet that the dealer has blackjack.'],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl border border-white/10 p-3">
                <dt className="font-semibold text-ivory">{t}</dt>
                <dd className="text-xs text-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {tab === 'payouts' && (
        <div className="mt-5 space-y-5 text-sm text-cream/85">
          <table className="w-full text-left">
            <caption className="sr-only">Blackjack payouts</caption>
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="py-2">Result</th>
                <th scope="col" className="py-2">Pays</th>
                <th scope="col" className="py-2">Bet 100, you get back</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {[
                ['Blackjack', '3 to 2', 250],
                ['Win', '1 to 1', 200],
                ['Push (tie)', 'Bet returned', 100],
                ['Surrender', 'Half returned', 50],
                ['Insurance (dealer blackjack)', '2 to 1', 'Insurance × 3'],
              ].map(([r, p, x]) => (
                <tr key={String(r)}>
                  <td className="py-2 text-ivory">{r}</td>
                  <td className="py-2 text-gold-200">{p}</td>
                  <td className="py-2">{typeof x === 'number' ? <ChipAmount value={x} iconClassName="h-4 w-4" /> : x}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <h3 className="font-semibold text-ivory">House rules</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-cream/80">
              <li>6-deck shoe, reshuffled after about 75% is dealt.</li>
              <li>Dealer stands on all 17s, including soft 17.</li>
              <li>Dealer peeks for blackjack when showing an Ace or a ten.</li>
              <li>Double on any first two cards, including after a split.</li>
              <li>Split up to 3 hands. Split Aces get one card each; 21 after a split isn't a blackjack.</li>
              <li>Late surrender on your first two cards.</li>
            </ul>
          </div>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            With these rules and perfect basic strategy the house edge is roughly 0.5%. Every card is shuffled and dealt
            by the server, never in your browser. Play chips have no cash value.
          </p>
        </div>
      )}

      {tab === 'keys' && (
        <dl className="mt-5 grid grid-cols-2 gap-2 text-sm">
          {[
            ['H', 'Hit'],
            ['S', 'Stand'],
            ['D', 'Double'],
            ['P', 'Split'],
            ['R', 'Surrender'],
            ['Y / N', 'Insurance yes / no'],
            ['Enter', 'Place bet'],
          ].map(([k, a]) => (
            <div key={k} className="flex items-center gap-3 rounded-xl border border-white/10 p-2.5">
              <kbd className="min-w-10 rounded-md border border-white/20 bg-ink-950 px-2 py-1 text-center font-mono text-xs text-gold-200">
                {k}
              </kbd>
              <span className="text-cream/85">{a}</span>
            </div>
          ))}
        </dl>
      )}
    </Modal>
  );
}

interface HistoryRow {
  id: number;
  wagered: number;
  returned: number;
  net: number;
  outcome: 'win' | 'loss' | 'push';
  created_at: string;
  summary: {
    round_no?: number;
    hands?: { cards: number[]; total: number; result: string; bet: number }[];
    dealer?: { cards: number[]; total: number };
  };
}

export function BlackjackHistoryModal({
  open,
  onClose,
  recent,
}: {
  open: boolean;
  onClose: () => void;
  recent: { round_no: number; dealer_total: number; dealer_result: string }[];
}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('game_history')
      .select('id, wagered, returned, net, outcome, created_at, summary')
      .eq('game_key', 'blackjack')
      .order('id', { ascending: false })
      .limit(20);
    if (err) setError(friendlyError(err));
    else setRows(data as HistoryRow[]);
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Hand history" className="max-h-[90dvh] max-w-xl overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold text-ivory">Hand history</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:text-ivory">
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {recent.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Dealer, last hands at this table</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recent.map((r) => (
              <span
                key={r.round_no}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-bold tabular-nums',
                  r.dealer_result === 'bust' ? 'bg-felt-700 text-felt-300' : r.dealer_result === 'blackjack' ? 'bg-gold-500 text-ink-950' : 'bg-ink-700 text-cream',
                )}
                title={`Hand ${r.round_no}`}
              >
                {r.dealer_result === 'bust' ? 'Bust' : r.dealer_result === 'blackjack' ? 'BJ' : r.dealer_total}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted">Your recent hands</p>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : rows === null ? (
        <LoadingState label="Loading history…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No hands yet" message="Your finished hands will show up here." />
      ) : (
        <ul className="mt-2 divide-y divide-white/[0.06]">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {r.summary.hands?.map((h, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <CardFan cards={h.cards} size="sm" />
                      <span className="text-xs text-cream/80">{h.total}</span>
                    </span>
                  ))}
                  {r.summary.dealer && (
                    <span className="text-xs text-muted">vs dealer {r.summary.dealer.total > 21 ? 'bust' : r.summary.dealer.total}</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-subtle">
                  Hand {r.summary.round_no ?? '—'} · {formatRelativeTime(r.created_at)}
                </p>
              </div>
              <ChipAmount
                value={r.net}
                signed
                className={cn('shrink-0 text-sm font-semibold', r.net > 0 ? 'text-felt-300' : r.net < 0 ? 'text-ruby-300' : 'text-cream')}
                iconClassName="h-4 w-4"
              />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
