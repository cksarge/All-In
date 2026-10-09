import { motion } from 'framer-motion';
import { ChipIcon, type ChipColor } from '@/components/ui/ChipIcon';

const colors: ChipColor[] = ['ruby', 'gold', 'felt', 'sapphire', 'onyx'];

/** A celebratory burst of chips. Purely decorative; framer-motion skips it under reduced motion. */
export function ChipBurst({ count = 14 }: { count?: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 70 + Math.random() * 70;
        return (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2"
            initial={{ x: 0, y: 0, scale: 0.4, opacity: 1, rotate: 0 }}
            animate={{
              x: Math.cos(angle) * dist,
              y: Math.sin(angle) * dist + 30,
              scale: 1,
              opacity: 0,
              rotate: (Math.random() - 0.5) * 540,
            }}
            transition={{ duration: 1.1 + Math.random() * 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <ChipIcon className="-ml-3 -mt-3 h-6 w-6" color={colors[i % colors.length]} />
          </motion.div>
        );
      })}
    </div>
  );
}
