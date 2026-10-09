import { PASSWORD_RULES } from '@/lib/validation';
import { cn } from '@/components/ui/cn';

export function PasswordChecklist({ password, id }: { password: string; id?: string }) {
  return (
    <ul id={id} className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li key={rule.id} className={cn('flex items-center gap-2 transition-colors', met ? 'text-felt-300' : 'text-muted')}>
            <span
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded-full border transition',
                met ? 'border-felt-400 bg-felt-500 text-ivory' : 'border-white/20',
              )}
              aria-hidden="true"
            >
              {met && (
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5">
                  <path d="M2.5 6.2l2.2 2.2 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <span>
              {rule.label}
              <span className="sr-only">{met ? ' (done)' : ' (not yet)'}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
