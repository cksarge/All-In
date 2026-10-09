import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';

/** "You're still seated" banner, so a dropped player can jump straight back in. */
export function ReturnToTable() {
  const [seat, setSeat] = useState<{ table_id: string; name: string; seat_no: number } | null>(null);
  useEffect(() => {
    // Short delay: leaving a table by navigating here releases the seat a moment later.
    const t = window.setTimeout(() => {
      void supabase.rpc('my_table').then(({ data }) => setSeat((data as typeof seat) ?? null));
    }, 900);
    return () => window.clearTimeout(t);
  }, []);
  if (!seat) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-500/40 bg-gold-500/10 px-5 py-4"
      role="status"
    >
      <p className="text-sm text-cream/90">
        You still have a seat at <strong className="text-gold-200">{seat.name}</strong> (seat {seat.seat_no}). It&apos;s held
        for 2 minutes after you leave.
      </p>
      <Link
        to={`/table/${seat.table_id}`}
        className="rounded-xl bg-gradient-to-b from-gold-300 to-gold-600 px-4 py-2 text-sm font-semibold text-ink-950"
      >
        Return to your table
      </Link>
    </motion.div>
  );
}
