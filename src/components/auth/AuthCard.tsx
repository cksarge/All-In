import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

export function AuthCard({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-10 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="surface border-gold-500/15 p-6 sm:p-8"
      >
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-3xl font-bold text-ivory">{title}</h1>
        {subtitle && <div className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</div>}
        <div className="gold-rule my-6" />
        {children}
      </motion.div>
      {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
    </div>
  );
}
