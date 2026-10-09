import { motion } from 'framer-motion';
import { ButtonLink } from '@/components/ui/Button';
import { ChipIcon, type ChipColor } from '@/components/ui/ChipIcon';
import { GameIcon } from '@/components/ui/GameIcon';
import { useAuth } from '@/stores/authStore';

const GAME_GROUPS = [
  { key: 'poker_holdem', title: 'Poker', body: "Hold'em, Omaha, Omaha Hi-Lo, Seven-Card Stud and Five-Card Draw with 2–9 players." },
  { key: 'blackjack', title: 'Blackjack', body: 'Up to five players against the dealer. Split, double, insurance and surrender.' },
  { key: 'roulette', title: 'Roulette', body: 'European and American wheels on a shared table, with hot and cold numbers.' },
  { key: 'craps', title: 'Craps', body: 'A rotating shooter, the full layout, and a beginner mode for the simple bets.' },
  { key: 'slots_classic', title: 'Slots', body: 'Six machines with their own themes, paytables and a shared progressive jackpot.' },
  { key: 'keno', title: 'And more', body: 'Baccarat, video poker, Three Card Poker, Pai Gow, Sic Bo, Keno and the Big Six wheel.' },
];

const FREE_POINTS = [
  { title: 'Nothing to pay for', body: 'There is no store. Every chip, avatar, card back and table felt is earned by playing.' },
  { title: 'Chips have no cash value', body: "Play chips can't be exchanged, transferred, sold or redeemed for anything." },
  { title: 'No gambling', body: 'You never risk anything of value. It’s the thrill of the table, just for fun.' },
  { title: 'Never stuck', body: 'A free daily bonus and free refills mean you can always get back in the game.' },
];

function FloatingChip({ color, className, delay }: { color: ChipColor; className: string; delay: number }) {
  return (
    <motion.div
      className={`absolute ${className}`}
      initial={{ opacity: 0, y: 30, rotate: -30 }}
      animate={{ opacity: 1, y: [0, -12, 0], rotate: [0, 8, 0] }}
      transition={{
        opacity: { delay, duration: 0.6 },
        y: { delay, duration: 6, repeat: Infinity, ease: 'easeInOut' },
        rotate: { delay, duration: 8, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      <ChipIcon className="h-full w-full drop-shadow-[0_12px_18px_rgba(0,0,0,0.6)]" color={color} />
    </motion.div>
  );
}

function HeroArt() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-md" aria-hidden="true">
      <div className="felt absolute inset-[8%] rounded-full border-[10px] border-[#3a2412] shadow-[inset_0_0_60px_rgba(0,0,0,0.6),0_30px_60px_-20px_rgba(0,0,0,0.8)]" />
      <div className="absolute inset-[16%] rounded-full border border-gold-500/25" />
      {[
        { r: -14, x: '28%', d: 0.2 },
        { r: 4, x: '40%', d: 0.35 },
        { r: 18, x: '52%', d: 0.5 },
      ].map((c, i) => (
        <motion.div
          key={i}
          className="absolute top-[30%] h-[34%] w-[24%] rounded-xl border border-gold-500/40 bg-ivory shadow-xl"
          style={{ left: c.x }}
          initial={{ y: -80, opacity: 0, rotate: 0 }}
          animate={{ y: 0, opacity: 1, rotate: c.r }}
          transition={{ delay: c.d, type: 'spring', stiffness: 120, damping: 14 }}
        >
          <div className="flex h-full flex-col justify-between p-2 font-display font-bold">
            <span className={i === 1 ? 'text-ink-900' : 'text-ruby-600'}>{['A', 'K', 'A'][i]}</span>
            <span className={`self-center text-3xl ${i === 1 ? 'text-ink-900' : 'text-ruby-600'}`}>{['♥', '♠', '♦'][i]}</span>
            <span className={`self-end rotate-180 ${i === 1 ? 'text-ink-900' : 'text-ruby-600'}`}>{['A', 'K', 'A'][i]}</span>
          </div>
        </motion.div>
      ))}
      <FloatingChip color="ruby" className="left-[10%] top-[62%] h-[16%] w-[16%]" delay={0.6} />
      <FloatingChip color="gold" className="right-[8%] top-[18%] h-[14%] w-[14%]" delay={0.8} />
      <FloatingChip color="felt" className="right-[16%] top-[66%] h-[12%] w-[12%]" delay={1} />
      <FloatingChip color="sapphire" className="left-[16%] top-[14%] h-[10%] w-[10%]" delay={1.2} />
    </div>
  );
}

export default function LandingPage() {
  const signedIn = useAuth((s) => s.status === 'signedIn');

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:pt-16 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">The free-play casino lounge</p>
          <h1 className="mt-4 font-display text-5xl font-extrabold leading-[1.05] text-ivory sm:text-6xl">
            Pull up a chair. <span className="gold-text animate-shimmer">Go all in.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-cream/85">
            Poker, blackjack, roulette, craps, slots and more, played live with friends in a premium lounge.
          </p>

          <div
            className="mt-7 rounded-2xl border-2 border-gold-500/50 bg-gradient-to-br from-gold-500/15 to-transparent p-5"
            role="note"
            aria-label="Free to play statement"
          >
            <div className="flex items-start gap-3">
              <ChipIcon className="mt-0.5 h-8 w-8" color="gold" />
              <div>
                <p className="font-display text-xl font-bold text-gold-200">100% free. Play chips only.</p>
                <p className="mt-1 text-[0.95rem] leading-relaxed text-cream/90">
                  All In involves <strong>no gambling</strong>, <strong>no purchases</strong> and{' '}
                  <strong>no real money</strong>, ever. Chips have no cash value and can’t be exchanged for anything.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {signedIn ? (
              <ButtonLink to="/lounge" size="lg">
                Enter the lounge
              </ButtonLink>
            ) : (
              <>
                <ButtonLink to="/signup" size="lg">
                  Create free account
                </ButtonLink>
                <ButtonLink to="/login" size="lg" variant="outline">
                  Log in
                </ButtonLink>
              </>
            )}
          </div>
          <p className="mt-4 text-sm text-muted">New players start with 10,000 free play chips.</p>
        </div>
        <HeroArt />
      </section>

      {/* Games */}
      <section className="border-y border-white/[0.05] bg-ink-950/40 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="font-display text-3xl font-bold text-ivory sm:text-4xl">Every table in the house</h2>
          <p className="mt-2 max-w-2xl text-muted">
            Multiplayer tables with live seats, quick-chat and emotes, plus solo games when you want to play at your own pace.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {GAME_GROUPS.map((g) => (
              <li key={g.title} className="surface flex gap-4 p-5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-felt-800 to-ink-900">
                  <GameIcon gameKey={g.key} />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-ivory">{g.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{g.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Free means free */}
      <section className="py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="font-display text-3xl font-bold text-ivory sm:text-4xl">Free means free</h2>
          <p className="mt-2 max-w-2xl text-muted">
            All In is a social game. Progress, cosmetics and leaderboard glory are earned at the tables, never paid for.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FREE_POINTS.map((p) => (
              <li key={p.title} className="surface p-5">
                <ChipIcon className="h-7 w-7" color="gold" />
                <h3 className="mt-3 font-semibold text-ivory">{p.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
          {!signedIn && (
            <div className="mt-12 flex flex-col items-center gap-4 text-center">
              <p className="font-display text-2xl text-ivory">Your seat is open.</p>
              <ButtonLink to="/signup" size="lg">
                Play free now
              </ButtonLink>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
