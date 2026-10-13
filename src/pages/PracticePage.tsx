import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { Die } from '@/components/craps/Dice';
import { Button, ButtonLink } from '@/components/ui/Button';
import { GameIcon } from '@/components/ui/GameIcon';
import { cn } from '@/components/ui/cn';
import { useRemembered } from '@/hooks/useRemembered';
import { cardName } from '@/lib/cards';
import { DRILLS, type CrapsQuestion, type Drill, type Question } from '@/lib/practice';
import { playSound } from '@/lib/sound';

interface Tally {
  right: number;
  total: number;
  streak: number;
  best: number;
}
const EMPTY: Tally = { right: 0, total: 0, streak: 0, best: 0 };
const validTally = (t: Tally) => Boolean(t) && [t.right, t.total, t.streak, t.best].every((n) => Number.isInteger(n) && n >= 0);

/** /practice and /practice/:drill. Drills cost nothing and pay nothing: they run entirely in the browser. */
export default function PracticePage() {
  const { drill } = useParams();
  const current = DRILLS.find((d) => d.key === drill);
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">No chips at stake</p>
          <h1 className="font-display text-4xl font-bold text-ivory">{current ? current.name : 'Practice'}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            {current
              ? current.blurb
              : 'Quick drills that teach the games. Nothing is bet and nothing is won here: answer, see why, and try the next one. Your score is kept on this device only.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {current && (
            <ButtonLink to="/practice" variant="outline" size="sm">
              All drills
            </ButtonLink>
          )}
          <ButtonLink to="/lounge" variant="ghost" size="sm">
            ← Lounge
          </ButtonLink>
        </div>
      </header>

      {current ? (
        <DrillRunner key={current.key} drill={current} />
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {DRILLS.map((d) => (
            <DrillCard key={d.key} drill={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DrillCard({ drill }: { drill: Drill }) {
  const [tally] = useRemembered<Tally>(`practice:${drill.key}`, EMPTY, validTally);
  return (
    <li className="surface group relative flex gap-4 p-4 transition hover:border-gold-500/30">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-gradient-to-br from-felt-800 to-ink-900">
        <GameIcon gameKey={drill.icon} className="h-9 w-9" />
      </div>
      <div className="min-w-0">
        <h2 className="font-display text-lg font-bold leading-tight text-ivory">{drill.name}</h2>
        <p className="mt-1 text-sm text-muted">{drill.blurb}</p>
        <p className="mt-1.5 text-xs text-subtle">
          {tally.total > 0 ? `${tally.right} of ${tally.total} right · best streak ${tally.best}` : 'Not tried yet'}
        </p>
        <Link to={`/practice/${drill.key}`} className="mt-2 inline-flex text-sm font-semibold text-gold-300 after:absolute after:inset-0 hover:underline">
          Start the drill →
        </Link>
      </div>
    </li>
  );
}

function DrillRunner({ drill }: { drill: Drill }) {
  const [q, setQ] = useState<Question>(() => drill.make());
  const [n, setN] = useState(1);
  const [given, setGiven] = useState<string | null>(null);
  const [holds, setHolds] = useState<boolean[]>([false, false, false, false, false]);
  const [tally, setTally] = useRemembered<Tally>(`practice:${drill.key}`, EMPTY, validTally);
  const isHolds = Boolean(q.holds);
  const correct = given !== null && given === q.answer;

  const answer = useCallback(
    (key: string) => {
      if (given !== null) return;
      const ok = key === q.answer;
      setGiven(key);
      playSound(ok ? 'success' : 'error');
      setTally((t) => {
        const streak = ok ? t.streak + 1 : 0;
        return { right: t.right + (ok ? 1 : 0), total: t.total + 1, streak, best: Math.max(t.best, streak) };
      });
    },
    [given, q.answer, setTally],
  );
  const next = () => {
    setQ(drill.make());
    setN((x) => x + 1);
    setGiven(null);
    setHolds([false, false, false, false, false]);
  };

  const dice = (q as CrapsQuestion).dice;
  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_15rem]">
      <section className="felt rounded-3xl border border-white/10 p-4 shadow-card sm:p-6" aria-label="Question">
        <p className="text-xs font-semibold uppercase tracking-wider text-cream/70">Question {n}</p>
        <h2 className="mt-1 font-display text-xl font-bold text-ivory sm:text-2xl">{q.prompt}</h2>

        {dice && (
          <div className="mt-4 flex items-center gap-3" role="img" aria-label={`The dice show ${dice[0]} and ${dice[1]}`}>
            <Die value={dice[0]} className="h-14 w-14" />
            <Die value={dice[1]} className="h-14 w-14" />
            <span className="font-display text-2xl font-bold text-ivory">= {dice[0] + dice[1]}</span>
          </div>
        )}

        <div key={n} className="mt-4 flex flex-wrap gap-x-8 gap-y-4">
          {q.groups.map((g) => (
            <div key={g.label}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-cream/75">{g.label}</p>
              <div className="flex gap-1.5">
                {g.cards.map((c, i) =>
                  isHolds ? (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={holds[i]}
                      aria-label={`${cardName(c)}${holds[i] ? ', held' : ''}`}
                      disabled={given !== null}
                      onClick={() => {
                        playSound('click');
                        setHolds((h) => h.map((v, k) => (k === i ? !v : v)));
                      }}
                      className="flex flex-col items-center gap-1 rounded-lg"
                    >
                      <PlayingCard card={c} size="md" index={i} highlight={given !== null ? q.holds?.[i] : holds[i]} dim={given !== null && !q.holds?.[i]} />
                      <span className={cn('text-[0.65rem] font-bold uppercase tracking-wider', holds[i] ? 'text-gold-200' : 'text-transparent')}>Held</span>
                    </button>
                  ) : (
                    <PlayingCard key={c} card={c} size="md" index={i} />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
        {q.facts && <p className="mt-4 max-w-xl text-sm leading-relaxed text-cream/90">{q.facts}</p>}

        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Your answer">
          {isHolds ? (
            <Button disabled={given !== null} onClick={() => answer(holds.map((h) => (h ? '1' : '0')).join(''))}>
              Check my holds
            </Button>
          ) : (
            q.choices.map((c) => (
              <Button
                key={c.key}
                variant={given !== null && c.key === q.answer ? 'gold' : 'outline'}
                disabled={given !== null}
                className={cn(given !== null && c.key === given && c.key !== q.answer && 'border-ruby-400 text-ruby-200 opacity-100')}
                onClick={() => answer(c.key)}
              >
                {c.label}
                {given !== null && c.key === q.answer ? ' ✓' : given === c.key ? ' ✗' : ''}
              </Button>
            ))
          )}
        </div>

        <div aria-live="polite" className="mt-4 min-h-24">
          {given !== null && (
            <div className={cn('rounded-xl border p-4', correct ? 'border-felt-400/60 bg-felt-600/30' : 'border-ruby-400/50 bg-ruby-900/30')}>
              <p className={cn('font-display text-lg font-bold', correct ? 'text-felt-300' : 'text-ruby-200')}>
                {correct ? 'Correct.' : isHolds ? 'Not quite. The best holds are lit up.' : `Not quite. The answer is: ${q.choices.find((c) => c.key === q.answer)?.label}.`}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-cream/90">{q.why}</p>
              <Button className="mt-3" size="sm" onClick={next} autoFocus>
                Next question
              </Button>
            </div>
          )}
        </div>
      </section>

      <aside className="surface h-fit p-5" aria-label="Your score">
        <h2 className="font-display text-lg font-bold text-ivory">Your score</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Right" value={`${tally.right} of ${tally.total}`} />
          <Row label="Accuracy" value={tally.total ? `${Math.round((tally.right / tally.total) * 100)}%` : '·'} />
          <Row label="Streak" value={String(tally.streak)} />
          <Row label="Best streak" value={String(tally.best)} />
        </dl>
        <button type="button" className="mt-3 text-xs font-semibold text-gold-300 hover:underline disabled:opacity-40" disabled={tally.total === 0} onClick={() => setTally(EMPTY)}>
          Reset my score
        </button>
        <p className="mt-4 border-t border-white/10 pt-3 text-xs leading-relaxed text-muted">
          Practice is free and pays nothing. Ready for the real thing?
        </p>
        <ButtonLink to={drill.play.to} variant="outline" size="sm" block className="mt-2">
          {drill.play.label}
        </ButtonLink>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-ivory">{value}</dd>
    </div>
  );
}
