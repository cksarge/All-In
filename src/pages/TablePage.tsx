import { QuickStart } from '@/components/onboarding/QuickStart';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BlackjackTable } from '@/components/blackjack/BlackjackTable';
import { CrapsTable } from '@/components/craps/CrapsTable';
import { PokerTable } from '@/components/poker/PokerTable';
import { RouletteTable } from '@/components/roulette/RouletteTable';
import { WaitingRoom } from '@/components/table/WaitingRoom';
import { TeenPattiTable } from '@/components/teenpatti/TeenPattiTable';
import { Button } from '@/components/ui/Button';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/** /table/:id: looks up which game the table plays and renders it. */
export default function TablePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [game, setGame] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGame(null);
    setError(null);
    void supabase
      .from('game_tables')
      .select('game_key, status')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) setError(friendlyError(err));
        else if (!data || data.status !== 'open') setError("This table is closed, or it's private and you don't have the invite.");
        else setGame(data.game_key as string);
      });
  }, [id]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="surface">
          <ErrorState title="Table not available" message={error} />
          <div className="flex justify-center pb-6">
            <Button variant="outline" size="sm" onClick={() => navigate('/lobby')}>
              Back to the lobby
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!game) return <FullPageLoader label="Finding your table…" />;
  const table =
    game === 'blackjack' ? <BlackjackTable key={id} tableId={id} /> :
    game === 'roulette' ? <RouletteTable key={id} tableId={id} /> :
    game === 'craps' ? <CrapsTable key={id} tableId={id} /> :
    game === 'teen_patti_live' ? <TeenPattiTable key={id} tableId={id} /> :
    game.startsWith('poker_') ? <PokerTable key={id} tableId={id} /> : null;
  if (table) {
    return (
      <>
        <WaitingRoom tableId={id} />
        {table}
        <QuickStart key={game} guide={game} />
      </>
    );
  }
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="surface">
        <ErrorState title="Opening soon" message="This game's tables aren't open yet." />
      </div>
    </div>
  );
}
