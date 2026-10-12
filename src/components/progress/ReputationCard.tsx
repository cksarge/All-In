import { useEffect } from 'react';
import { cn } from '@/components/ui/cn';
import { formatRelativeTime } from '@/lib/format';
import { REPUTATION_REASONS, useReputation } from '@/stores/reputationStore';

const until = (iso: string) => (new Date(iso).getFullYear() > 9000 ? 'until a moderator lifts it' : `until ${new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`);

/** Your own reputation: the number, what it lets you do, how it moves and what changed it. Shown only to you. */
export function ReputationCard() {
  const rep = useReputation((s) => s.rep);
  const fetch = useReputation((s) => s.fetch);
  useEffect(() => void fetch(), [fetch]);
  if (!rep) return null;
  const c = rep.config;
  const tone = rep.score >= c.tiers[0] ? 'text-gold-200' : rep.score > c.chat_off ? 'text-felt-300' : 'text-ruby-300';
  const marks = [c.quick_off, c.chat_off, ...c.tiers.filter((t) => t < 100)];

  return (
    <section className="surface mt-6 p-5" aria-labelledby="reputation-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="reputation-h" className="font-display text-xl font-bold text-ivory">
          Reputation
        </h2>
        <p className="text-xs text-muted">Only you and the moderator can see this.</p>
      </div>

      <div className="mt-3 flex items-end gap-3">
        <p className={cn('font-display text-5xl font-black tabular-nums', tone)}>{rep.score}</p>
        <p className="pb-1.5 text-sm text-muted">out of 100</p>
      </div>
      <div className="relative mt-2 h-2.5 rounded-full bg-ink-950/70" role="img" aria-label={`Reputation ${rep.score} out of 100`}>
        <div className={cn('h-full rounded-full', rep.score >= c.tiers[0] ? 'bg-gold-400' : rep.score > c.chat_off ? 'bg-felt-400' : 'bg-ruby-400')} style={{ width: `${rep.score}%` }} />
        {marks.map((m) => (
          <span key={m} className="absolute top-[-3px] h-4 w-px bg-white/40" style={{ left: `${m}%` }} aria-hidden="true" />
        ))}
      </div>

      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <li className={cn('rounded-xl border p-3', rep.can_chat ? 'border-white/[0.07]' : 'border-ruby-500/40 bg-ruby-900/15')}>
          <p className="font-semibold text-ivory">Typed chat: {rep.can_chat ? 'on' : 'off'}</p>
          <p className="mt-0.5 text-xs text-muted">
            {rep.chat_banned_until ? `Switched off by a moderator ${until(rep.chat_banned_until)}.` : `Needs a reputation above ${c.chat_off}.`}
          </p>
        </li>
        <li className={cn('rounded-xl border p-3', rep.can_quick ? 'border-white/[0.07]' : 'border-ruby-500/40 bg-ruby-900/15')}>
          <p className="font-semibold text-ivory">Quick chat and emotes: {rep.can_quick ? 'on' : 'off'}</p>
          <p className="mt-0.5 text-xs text-muted">
            {rep.quick_banned_until ? `Switched off by a moderator ${until(rep.quick_banned_until)}.` : `Needs a reputation above ${c.quick_off}.`}
          </p>
        </li>
      </ul>

      <div className="mt-4 grid gap-4 text-sm text-cream/85 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">How it goes up</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>
              1 point for every {c.gain_every} clean typed messages, up to {c.gain_cap} points a day. You are at {rep.clean_count} of {c.gain_every}
              {rep.gained_today >= c.gain_cap ? ', and have had today’s points' : ''}.
            </li>
            <li>
              Below {c.recover_to}: {c.recover} points for each day you play a round, back up to {c.recover_to}.
            </li>
            <li>
              At {c.tiers.join(' and ')} you earn an achievement and cosmetics that are yours for as long as your reputation stays that high.
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">How it goes down</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>
              Swearing, spam or advertising in chat: one warning a day, then {c.filter_penalty} points each time.
            </li>
            <li>A warning, a removed username, a timeout or a ban from a moderator.</li>
            <li>Making a report that turns out to be false.</li>
          </ul>
        </div>
      </div>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Recent changes</h3>
      {rep.log.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted">Nothing yet. Everyone starts at {c.start}.</p>
      ) : (
        <ul className="mt-1.5 divide-y divide-white/[0.06] text-sm">
          {rep.log.slice(0, 8).map((l, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate text-cream/85">
                {REPUTATION_REASONS[l.reason] ?? 'Changed'}
                {l.reason === 'warning' && l.note ? `: ${l.note}` : ''}
                <span className="ml-2 text-xs text-muted">{formatRelativeTime(l.at)}</span>
              </span>
              <span className={cn('shrink-0 font-semibold tabular-nums', l.delta > 0 ? 'text-felt-300' : l.delta < 0 ? 'text-ruby-300' : 'text-muted')}>
                {l.delta > 0 ? `+${l.delta}` : l.delta === 0 ? 'warning' : l.delta} → {l.score}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
