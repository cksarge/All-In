import { QuickStart } from '@/components/onboarding/QuickStart';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { BingoGame } from '@/components/more/BingoGame';
import { CasinoWarGame } from '@/components/more/CasinoWarGame';
import { CrashGame } from '@/components/more/CrashGame';
import { DragonTigerGame } from '@/components/more/DragonTigerGame';
import { MinesGame } from '@/components/more/MinesGame';
import { PlinkoGame } from '@/components/more/PlinkoGame';
import { PowerDrawGame } from '@/components/more/PowerDrawGame';
import { ScratchGame } from '@/components/more/ScratchGame';
import { UltimateHoldemGame } from '@/components/more/UltimateHoldemGame';
import { SlotMachine } from '@/components/slots/SlotMachine';
import { BaccaratGame } from '@/components/solo/BaccaratGame';
import { KenoGame } from '@/components/solo/KenoGame';
import { PaiGowGame } from '@/components/solo/PaiGowGame';
import { SicBoGame } from '@/components/solo/SicBoGame';
import { ThreeCardGame } from '@/components/solo/ThreeCardGame';
import { VideoPokerGame } from '@/components/solo/VideoPokerGame';
import { WheelGame } from '@/components/solo/WheelGame';
import { TablePokerGame } from '@/components/tablepoker/TablePokerGame';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/States';

/** /play/:gameKey: solo games (no table to join). */
export default function PlayPage() {
  const { gameKey = '' } = useParams();
  return (
    <>
      <Game gameKey={gameKey} />
      <QuickStart key={gameKey} guide={gameKey} />
    </>
  );
}

const TABLE_POKER = new Set(['caribbean_stud', 'casino_holdem', 'let_it_ride', 'mississippi_stud', 'four_card_poker', 'teen_patti']);

function Game({ gameKey }: { gameKey: string }) {
  const navigate = useNavigate();
  if (gameKey.startsWith('slots_')) return <SlotMachine key={gameKey} gameKey={gameKey} />;
  if (gameKey.startsWith('video_poker_')) return <VideoPokerGame key={gameKey} gameKey={gameKey} />;
  if (TABLE_POKER.has(gameKey)) return <TablePokerGame key={gameKey} gameKey={gameKey} />;
  if (gameKey === 'baccarat') return <BaccaratGame />;
  if (gameKey === 'three_card_poker') return <ThreeCardGame />;
  if (gameKey === 'pai_gow_poker') return <PaiGowGame />;
  if (gameKey === 'sic_bo') return <SicBoGame />;
  if (gameKey === 'keno') return <KenoGame />;
  if (gameKey === 'money_wheel') return <WheelGame />;
  if (gameKey === 'dragon_tiger') return <DragonTigerGame />;
  if (gameKey === 'casino_war') return <CasinoWarGame />;
  if (gameKey === 'ultimate_holdem') return <UltimateHoldemGame />;
  if (gameKey === 'plinko') return <PlinkoGame />;
  if (gameKey === 'mines') return <MinesGame />;
  if (gameKey === 'scratch_cards') return <ScratchGame />;
  if (gameKey === 'power_draw') return <PowerDrawGame />;
  if (gameKey === 'crash') return <CrashGame />;
  if (gameKey === 'bingo') return <BingoGame />;
  if (gameKey === 'sng_poker' || gameKey === 'slot_showdown') return <Navigate to="/tournaments" replace />;
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="surface">
        <ErrorState title="Opening soon" message="This game isn't open yet." />
        <div className="flex justify-center pb-6">
          <Button variant="outline" size="sm" onClick={() => navigate('/lounge')}>
            Back to the lounge
          </Button>
        </div>
      </div>
    </div>
  );
}
