import { useState } from 'react';
import { InfoModal, TabButtons } from '@/components/table/InfoModal';
import { BET_INFO, type RlBetType, type RlVariant } from '@/lib/roulette';

type Tab = 'how' | 'payouts';

export function RouletteRulesModal({ open, onClose, variant }: { open: boolean; onClose: () => void; variant: RlVariant }) {
  const [tab, setTab] = useState<Tab>('how');
  const pockets = variant === 'american' ? 38 : 37;
  const edge = variant === 'american' ? '5.26%' : '2.70%';
  return (
    <InfoModal open={open} onClose={onClose} title="Roulette">
      <TabButtons
        tabs={[
          ['how', 'How to play'],
          ['payouts', 'Payouts & odds'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'how' ? (
        <div className="mt-5 space-y-3 text-sm leading-relaxed text-cream/85">
          <p>
            Pick a chip value, then tap the layout to place it. You can stack chips, cover as many spots as you like,
            and use <strong className="text-ivory">Undo</strong>, <strong className="text-ivory">Clear</strong> or{' '}
            <strong className="text-ivory">Rebet</strong>.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>The first chip on the table opens a 20-second betting window that everyone shares.</li>
            <li>When it closes, the server picks the winning pocket and the wheel spins. The result stays secret until the ball lands.</li>
            <li>Tap a number for a straight bet. Tap the line between two numbers for a split, a corner where four meet, the bottom edge of a column of three for a street, and the corner below two columns for a line.</li>
            <li>
              This is a{' '}
              <strong className="text-ivory">{variant === 'american' ? 'American wheel (0 and 00)' : 'European wheel (single 0)'}</strong>{' '}
              with {pockets} pockets. Zero{variant === 'american' ? 's' : ''} lose all outside bets.
            </li>
          </ul>
          <p className="text-xs text-muted">
            The <span className="text-gold-200">hot</span> and <span className="text-sapphire-300">cold</span> numbers show
            what has come up most and least at this table. Every spin is independent, so they're just for fun.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4 text-sm">
          <table className="w-full text-left">
            <caption className="sr-only">Roulette payouts</caption>
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="py-2">Bet</th>
                <th scope="col" className="py-2">Covers</th>
                <th scope="col" className="py-2">Pays</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {(['straight', 'split', 'street', 'corner', 'line', 'dozen', 'column', 'red', 'odd', 'low'] as RlBetType[]).map((k) => (
                <tr key={k}>
                  <td className="py-2 text-ivory">
                    {k === 'red' ? 'Red / Black' : k === 'odd' ? 'Odd / Even' : k === 'low' ? '1–18 / 19–36' : BET_INFO[k].name}
                  </td>
                  <td className="py-2 text-cream/75">{BET_INFO[k].covers}</td>
                  <td className="py-2 text-gold-200">{BET_INFO[k].pays}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            "35 to 1" means a winning 10-chip straight bet pays back 360 (your 10 plus 350). House edge on this wheel:{' '}
            {edge}. Every spin is decided by the server, never in your browser. Play chips have no cash value.
          </p>
        </div>
      )}
    </InfoModal>
  );
}
