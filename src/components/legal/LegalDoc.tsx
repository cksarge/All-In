import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LEGAL } from '@/lib/legal';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/** The page frame for the Terms of Service and the Privacy Policy: a summary, a contents list, numbered sections. */
export function LegalDoc({
  eyebrow,
  title,
  summary,
  sections,
  other,
}: {
  eyebrow: string;
  title: string;
  summary: ReactNode;
  sections: LegalSection[];
  other: { to: string; label: string };
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">{eyebrow}</p>
      <h1 className="mt-2 font-display text-4xl font-bold text-ivory sm:text-5xl">{title}</h1>
      <p className="mt-3 text-sm text-muted">
        Effective {LEGAL.effective} · See also the{' '}
        <Link to={other.to} className="font-semibold text-gold-300 hover:underline">
          {other.label}
        </Link>
      </p>

      <div className="mt-6 rounded-2xl border border-gold-500/40 bg-gold-500/[0.07] p-5 text-sm leading-relaxed text-cream/90">
        <p className="font-display text-lg font-bold text-gold-200">In short</p>
        <div className="mt-2 space-y-2">{summary}</div>
        <p className="mt-3 text-xs text-muted">This summary is here to help. The full text below is what applies.</p>
      </div>

      <nav aria-label="Contents" className="surface mt-8 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Contents</h2>
        <ol className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-cream/85 hover:text-gold-200 hover:underline">
                {i + 1}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-8 space-y-9">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="scroll-mt-24">
            <h2 className="font-display text-2xl font-bold text-ivory">
              {i + 1}. {s.title}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-cream/85 [&_a]:font-semibold [&_a]:text-gold-300 hover:[&_a]:underline [&_li]:pl-1 [&_strong]:text-ivory [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
              {s.body}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 border-t border-white/10 pt-5 text-xs text-muted">
        {title}, version {LEGAL.version}. Questions: <a href={`mailto:${LEGAL.email}`} className="text-gold-300 hover:underline">{LEGAL.email}</a>
      </p>
    </div>
  );
}

/** The contact address as a link. */
export function ContactEmail() {
  return <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;
}
