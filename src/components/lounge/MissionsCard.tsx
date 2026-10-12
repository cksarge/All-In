import { Link } from 'react-router-dom';
import { ButtonLink } from '@/components/ui/Button';
import { formatChips } from '@/lib/format';
import { seasonReady } from '@/lib/live';
import { MissionRow } from '@/pages/MissionsPage';
import { useLive } from '@/stores/liveStore';

/** Today's missions and this month's season, on the lounge. */
export function MissionsCard() {
  const data = useLive((s) => s.missions);
  if (!data) return null;
  const daily = data.missions.filter((m) => m.period === 'daily');
  const waiting = data.to_collect + seasonReady(data.season);
  return (
    <section className="surface p-5" aria-labelledby="missions-card-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="missions-card-h" className="font-display text-xl font-bold text-ivory">
          Today&apos;s missions
        </h2>
        <Link to="/missions" className="text-sm font-semibold text-gold-300 hover:underline">
          All missions →
        </Link>
      </div>
      <ul className="mt-3 space-y-2">
        {daily.map((m) => (
          <MissionRow key={m.slot} m={m} season={Boolean(data.season)} compact />
        ))}
      </ul>
      {data.season && (
        <p className="mt-3 text-xs text-muted">
          <span style={{ color: data.season.accent }} className="font-semibold">
            {data.season.name}
          </span>{' '}
          season: {formatChips(data.season.points)} points
        </p>
      )}
      {waiting > 0 && (
        <ButtonLink to="/missions" size="sm" block className="mt-3">
          Collect {waiting} reward{waiting === 1 ? '' : 's'}
        </ButtonLink>
      )}
    </section>
  );
}
