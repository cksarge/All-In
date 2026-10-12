import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { formatChips } from '@/lib/format';
import type { TourneyConfig } from '@/lib/tournaments';

/** How every kind of tournament works, with the numbers read from the server's config. */
export function TournamentRules({ open, onClose, config }: { open: boolean; onClose: () => void; config: TourneyConfig }) {
  const { sng, showdown, freeroll } = config;
  return (
    <Modal open={open} onClose={onClose} title="How tournaments work" className="max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-2xl font-bold text-ivory">How tournaments work</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mt-4 space-y-5 text-sm leading-relaxed text-cream/85">
        <section>
          <h3 className="font-display text-lg font-bold text-ivory">Sit &amp; Go poker</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>
              Pick a size and an entry. The moment the last seat fills, everyone is moved to a No-Limit Hold&apos;em table with{' '}
              <strong className="text-ivory">{formatChips(sng.stack)} tournament chips</strong> each.
            </li>
            <li>Tournament chips are only a score. They are not your play chips, and you can&apos;t add more.</li>
            <li>
              The blinds go up every {Math.round(sng.level_seconds / 60)} minutes, from {sng.levels[0].join('/')} to{' '}
              {sng.levels[sng.levels.length - 1].map((n) => formatChips(n)).join('/')}, so games finish quickly.
            </li>
            <li>Lose all your chips and you&apos;re out. The last player left wins.</li>
            <li>
              The whole prize pool is the entries added together. Heads-up and 3-player games pay the winner everything; 6-player games pay{' '}
              {sng.payouts['6']?.join('% and ')}% to first and second.
            </li>
            <li>You can change your mind and get your entry back until the game starts.</li>
            <li>
              Leaving the table once it has started counts as being knocked out. If you only lose your connection, your seat is kept: you&apos;re
              folded each hand and keep paying blinds until you come back.
            </li>
          </ul>
        </section>
        <section>
          <h3 className="font-display text-lg font-bold text-ivory">Sit &amp; Go formats and the Main Event</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-ivory">Turbo</strong> games raise the blinds every minute. <strong className="text-ivory">Omaha</strong> games deal four
              cards each and are pot limit: you must use exactly two of your cards.
            </li>
            <li>
              The <strong className="text-ivory">Main Event</strong> is a bigger Hold&apos;em tournament on several tables. Register any time before it starts;
              at the start time everyone is seated. If too few have entered, it is called off and entries are returned.
            </li>
            <li>As players go out, tables are evened up and merged between hands, so you may be moved. Your chips move with you.</li>
            <li>One poker tournament at a time: you can&apos;t be in a Sit &amp; Go and the Main Event together.</li>
            <li>Top finishes earn trophies, shown on your profile. Second place needs a field of three, third a field of four.</li>
          </ul>
        </section>
        <section>
          <h3 className="font-display text-lg font-bold text-ivory">Slot Showdown</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>
              A new round starts every {Math.round(showdown.round_seconds / 60)} minutes at each stake level, on a machine that changes from round
              to round.
            </li>
            <li>
              Everyone who enters gets <strong className="text-ivory">{showdown.spins} spins</strong> at the same fixed bet. Spins move no chips:
              every win is added to your score instead.
            </li>
            <li>When the clock runs out, the highest score wins. A tie goes to whoever finished their spins first.</li>
            <li>
              The entries make the prize pool. Up to 4 players: winner takes all. 5 to 9 players: 70% and 30%. 10 or more: 50%, 30% and 20%.
            </li>
            <li>If fewer than {showdown.min_players} players enter a round, it is called off and the entry is returned.</li>
          </ul>
        </section>
        <section>
          <h3 className="font-display text-lg font-bold text-ivory">Daily Freeroll</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>
              One a day, free to enter, with <strong className="text-ivory">{freeroll.spins} spins</strong>. It ends at 00:00 UTC.
            </li>
            <li>
              The house pays the top {freeroll.prizes.length}: <ChipAmount value={freeroll.prizes[0]} iconClassName="h-3.5 w-3.5" /> for first,{' '}
              <ChipAmount value={freeroll.prizes[1]} iconClassName="h-3.5 w-3.5" /> for second,{' '}
              <ChipAmount value={freeroll.prizes[2]} iconClassName="h-3.5 w-3.5" /> for third and{' '}
              <ChipAmount value={freeroll.prizes[3]} iconClassName="h-3.5 w-3.5" /> each for the rest.
            </li>
          </ul>
        </section>
        <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
          Entries and prizes are play chips. Free to play. No real money. No purchases. Chips have no cash value.
        </p>
      </div>
    </Modal>
  );
}
