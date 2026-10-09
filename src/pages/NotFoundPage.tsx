import { ButtonLink } from '@/components/ui/Button';
import { ChipIcon } from '@/components/ui/ChipIcon';

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <ChipIcon className="h-16 w-16 animate-spin-slow" color="onyx" />
      <h1 className="mt-6 font-display text-4xl font-bold text-ivory">This table is closed</h1>
      <p className="mt-3 text-muted">We couldn’t find that page. It may have moved, or the link might be mistyped.</p>
      <ButtonLink to="/" className="mt-8">
        Back to the lobby
      </ButtonLink>
    </div>
  );
}
