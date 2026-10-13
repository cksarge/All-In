import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { Die } from '@/components/craps/Dice';
import { Button, ButtonLink } from '@/components/ui/Button';
import { GameIcon } from '@/components/ui/GameIcon';
import { cn } from '@/components/ui/cn';
import { useRemembered } from '@/hooks/useRemembered';
import { cardName } from '@/lib/cards';
import { LESSONS, type Lesson, type LessonScene } from '@/lib/lessons';
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

/**
 * /practice, /practice/:drill and /practice/learn/:lesson. Two sections: "Learn to play" (walkthroughs of the
 * big games) and "Drills" (quick questions). Both cost nothing and pay nothing: they run entirely in the browser.
 */
export default function PracticePage() {
  const { drill, lesson } = useParams();
  const current = DRILLS.find((d) => d.key === drill);
  const learning = LESSONS.find((l) => l.key === lesson);
  const title = learning ? `Learn ${learning.name}` : current ? current.name : 'Practice';
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">No chips at stake</p>
          <h1 className="font-display text-4xl font-bold text-ivory">{title}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            {learning
              ? learning.blurb
              : current
                ? current.blurb
                : 'Learn a game step by step, then test yourself with quick drills. Nothing is bet and nothing is won here, and your progress is kept on this device only.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(current || learning) && (
            <ButtonLink to="/practice" variant="outline" size="sm">
              All practice
            </ButtonLink>
          )}
          <ButtonLink to="/lounge" variant="ghost" size="sm">
            ← Lounge
          </ButtonLink>
        </div>
      </header>

      {learning ? (
        <LessonRunner key={learning.key} lesson={learning} />
      ) : current ? (
        <DrillRunner key={current.key} drill={current} />
      ) : (
        <>
          <section aria-labelledby="learn-h" className="mt-8">
            <h2 id="learn-h" className="font-display text-2xl font-bold text-ivory">
              Learn to play
            </h2>
            <p className="mt-1 text-sm text-muted">
              New to a game? Each walkthrough takes you through a hand or a round a step at a time, and has you make the moves yourself.
            </p>
            <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {LESSONS.map((l) => (
                <LessonCard key={l.key} lesson={l} />
              ))}
            </ul>
          </section>
          <section aria-labelledby="drills-h" className="mt-10">
            <h2 id="drills-h" className="font-display text-2xl font-bold text-ivory">
              Drills
            </h2>
            <p className="mt-1 text-sm text-muted">Know the rules already? Quick questions, one after another, with the reason for every answer and a running score.</p>
            <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {DRILLS.map((d) => (
                <DrillCard key={d.key} drill={d} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Learn to play
// ---------------------------------------------------------------------------
/** How far a walkthrough has been taken on this device: the furthest step reached, and whether it was finished. */
interface Progress {
  step: number;
  done: boolean;
}
const NO_PROGRESS: Progress = { step: 0, done: false };
const validProgress = (p: Progress) => Boolean(p) && Number.isInteger(p.step) && p.step >= 0 && typeof p.done === 'boolean';

function LessonCard({ lesson }: { lesson: Lesson }) {
  const [progress] = useRemembered<Progress>(`lesson:${lesson.key}`, NO_PROGRESS, validProgress);
  return (
    <li className="surface group relative flex gap-4 p-4 transition hover:border-gold-500/30">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-gradient-to-br from-felt-800 to-ink-900">
        <GameIcon gameKey={lesson.icon} className="h-9 w-9" />
      </div>
      <div className="min-w-0">
        <h3 className="font-display text-lg font-bold leading-tight text-ivory">
          {lesson.name}
          {progress.done && <span className="ml-2 align-middle text-xs font-semibold uppercase tracking-wider text-felt-300">Finished ✓</span>}
        </h3>
        <p className="mt-1 text-sm text-muted">{lesson.blurb}</p>
        <p className="mt-1.5 text-xs text-subtle">
          {lesson.steps.length} steps · about {lesson.minutes} minutes
          {!progress.done && progress.step > 0 ? ` · you reached step ${Math.min(progress.step + 1, lesson.steps.length)}` : ''}
        </p>
        <Link to={`/practice/learn/${lesson.key}`} className="mt-2 inline-flex text-sm font-semibold text-gold-300 after:absolute after:inset-0 hover:underline">
          {progress.done ? 'Go through it again →' : progress.step > 0 ? 'Carry on →' : 'Start the walkthrough →'}
        </Link>
      </div>
    </li>
  );
}

const POCKET = { red: 'bg-ruby-600', black: 'bg-ink-950', green: 'bg-felt-600' } as const;

function Scene({ scene, n }: { scene: LessonScene; n: number }) {
  return (
    <div className="mt-4 space-y-4">
      {scene.dice && (
        <div className="flex items-center gap-3" role="img" aria-label={`The dice show ${scene.dice[0]} and ${scene.dice[1]}: ${scene.dice[0] + scene.dice[1]}`}>
          <Die value={scene.dice[0]} className="h-14 w-14" />
          <Die value={scene.dice[1]} className="h-14 w-14" />
          <span className="font-display text-2xl font-bold text-ivory">= {scene.dice[0] + scene.dice[1]}</span>
        </div>
      )}
      {scene.pocket && (
        <div className="flex items-center gap-3" role="img" aria-label={`The ball is in ${scene.pocket.colour} ${scene.pocket.n}`}>
          <span className={cn('flex h-16 w-16 items-center justify-center rounded-full border-4 border-gold-400 font-display text-2xl font-black text-ivory shadow-lg', POCKET[scene.pocket.colour])}>
            {scene.pocket.n}
          </span>
          <span className="text-sm capitalize text-cream/85">
            {scene.pocket.colour} {scene.pocket.n}
          </span>
        </div>
      )}
      {scene.groups && (
        <div key={n} className="flex flex-wrap gap-x-8 gap-y-4">
          {scene.groups.map((g) => (
            <div key={g.label}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-cream/75">{g.label}</p>
              <div className="flex gap-1.5" role="img" aria-label={`${g.label}: ${g.cards.map((c) => (c === null ? 'a face-down card' : cardName(c))).join(', ')}`}>
                {g.cards.map((c, i) => (
                  <PlayingCard key={i} card={c} size="md" index={i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {scene.facts && (
        <dl className="flex flex-wrap gap-2">
          {scene.facts.map(([label, value]) => (
            <div key={label + value} className="rounded-lg border border-white/10 bg-ink-950/50 px-3 py-1.5">
              <dt className="text-[0.6rem] font-semibold uppercase tracking-wider text-cream/60">{label}</dt>
              <dd className="text-sm font-semibold text-ivory">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function LessonRunner({ lesson }: { lesson: Lesson }) {
  const [progress, setProgress] = useRemembered<Progress>(`lesson:${lesson.key}`, NO_PROGRESS, validProgress);
  const total = lesson.steps.length;
  // Pick up where this device left off (from the start again once it has been finished).
  const [at, setAt] = useState(() => (progress.done ? 0 : Math.min(progress.step, total - 1)));
  const [picked, setPicked] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const step = lesson.steps[at];
  const choice = picked !== null ? step.ask?.choices[picked] : undefined;
  const solved = !step.ask || Boolean(choice?.right);

  useEffect(() => {
    setProgress((p) => (at > p.step ? { ...p, step: at } : p));
  }, [at, setProgress]);

  const go = (to: number) => {
    setPicked(null);
    setAt(to);
  };
  const next = () => {
    if (at < total - 1) return go(at + 1);
    setProgress({ step: total - 1, done: true });
    setFinished(true);
    playSound('success');
  };

  if (finished) {
    return (
      <section className="felt mt-6 rounded-3xl border border-white/10 p-6 text-center shadow-card sm:p-10" aria-label="Walkthrough finished">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">Walkthrough finished</p>
        <h2 className="mt-1 font-display text-3xl font-bold text-ivory">You know how {lesson.name} works</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-cream/85">
          The quickest way to make it stick is to use it. Try the drill for a few minutes, or sit down at the real thing at the lowest stakes.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {lesson.drill && <ButtonLink to={lesson.drill.to}>{lesson.drill.label}</ButtonLink>}
          <ButtonLink to={lesson.play.to} variant="outline">
            {lesson.play.label}
          </ButtonLink>
          <Button
            variant="ghost"
            onClick={() => {
              setFinished(false);
              go(0);
            }}
          >
            Go through it again
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="felt mt-6 rounded-3xl border border-white/10 p-4 shadow-card sm:p-6" aria-label={`${lesson.name} walkthrough`}>
      <div className="flex items-center gap-3">
        <p className="shrink-0 text-xs font-semibold uppercase tracking-wider text-cream/70">
          Step {at + 1} of {total}
        </p>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={at + 1} aria-label="Progress through the walkthrough">
          <div className="h-full rounded-full bg-gold-400 transition-all" style={{ width: `${((at + 1) / total) * 100}%` }} />
        </div>
      </div>
      <h2 className="mt-3 font-display text-2xl font-bold text-ivory">{step.title}</h2>
      <div className="mt-2 max-w-2xl space-y-2 text-sm leading-relaxed text-cream/90 sm:text-base">
        {step.text.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </div>
      {step.scene && <Scene scene={step.scene} n={at} />}

      {step.ask && (
        <div className="mt-5 rounded-2xl border border-gold-500/30 bg-ink-950/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gold-300">Your move</p>
          <p className="mt-1 font-semibold text-ivory">{step.ask.prompt}</p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Your move">
            {step.ask.choices.map((c, i) => (
              <Button
                key={c.label}
                variant={picked === i && c.right ? 'gold' : 'outline'}
                disabled={solved && picked !== i}
                className={cn(picked === i && !c.right && 'border-ruby-400 text-ruby-200')}
                onClick={() => {
                  if (solved) return;
                  setPicked(i);
                  playSound(c.right ? 'success' : 'error');
                }}
              >
                {c.label}
                {picked === i ? (c.right ? ' ✓' : ' ✗') : ''}
              </Button>
            ))}
          </div>
          <p aria-live="polite" className={cn('mt-3 min-h-10 text-sm leading-relaxed', choice ? (choice.right ? 'text-felt-300' : 'text-ruby-200') : 'text-muted')}>
            {choice ? `${choice.right ? '' : 'Not quite. '}${choice.why}${choice.right ? '' : ' Try again.'}` : 'Pick one to carry on.'}
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" disabled={at === 0} onClick={() => go(at - 1)}>
          ← Back
        </Button>
        <Button disabled={!solved} onClick={next}>
          {at === total - 1 ? 'Finish' : 'Next'}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Drills
// ---------------------------------------------------------------------------
function DrillCard({ drill }: { drill: Drill }) {
  const [tally] = useRemembered<Tally>(`practice:${drill.key}`, EMPTY, validTally);
  return (
    <li className="surface group relative flex gap-4 p-4 transition hover:border-gold-500/30">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-gradient-to-br from-felt-800 to-ink-900">
        <GameIcon gameKey={drill.icon} className="h-9 w-9" />
      </div>
      <div className="min-w-0">
        <h3 className="font-display text-lg font-bold leading-tight text-ivory">{drill.name}</h3>
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
