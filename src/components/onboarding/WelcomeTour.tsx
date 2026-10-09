import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { ChipIcon } from '@/components/ui/ChipIcon';
import { GameIcon } from '@/components/ui/GameIcon';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';

const STEPS = [
  {
    title: 'Welcome to All In',
    body: 'A free casino lounge for playing with friends. Everything here uses play chips. There is no real money, nothing to pay for, and chips have no cash value.',
    art: <ChipIcon className="h-16 w-16" color="gold" />,
  },
  {
    title: '10,000 chips to start',
    body: 'Your starting chips are already in your account. Collect a free bonus every day, and come back on consecutive days to grow your streak multiplier up to 3x.',
    art: <ChipIcon className="h-16 w-16" />,
  },
  {
    title: 'Never stuck',
    body: "If your chips run low, grab a free refill. Bigger tables (Mid, High, VIP) open up as your chip count grows.",
    art: <ChipIcon className="h-16 w-16" color="felt" />,
  },
  {
    title: 'Pick a table',
    body: 'Blackjack, poker, roulette, craps, slots and more. Every game has a “How to play” panel, so you can learn as you go.',
    art: <GameIcon gameKey="blackjack" className="h-16 w-16" />,
  },
];

export function WelcomeTour({ open, onDone }: { open: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  return (
    <Modal open={open} onClose={onDone} title="Welcome tour">
      <div className="flex flex-col items-center text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22 }}
            className="flex flex-col items-center"
          >
            <div className="mb-5 flex h-24 w-24 items-center justify-center rounded-full border border-gold-500/30 bg-gradient-to-b from-felt-700 to-felt-900">
              {s.art}
            </div>
            <h2 className="font-display text-2xl font-bold text-ivory">{s.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-cream/85">{s.body}</p>
          </motion.div>
        </AnimatePresence>

        <div className="mt-6 flex gap-2" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-6 bg-gold-400' : 'w-1.5 bg-white/20')}
            />
          ))}
        </div>

        <div className="mt-6 flex w-full gap-3">
          {step > 0 ? (
            <Button variant="ghost" className="flex-1" onClick={() => setStep((n) => n - 1)}>
              Back
            </Button>
          ) : (
            <Button variant="ghost" className="flex-1" onClick={onDone}>
              Skip
            </Button>
          )}
          <Button className="flex-1" data-autofocus onClick={() => (last ? onDone() : setStep((n) => n + 1))}>
            {last ? "Let's play" : 'Next'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
