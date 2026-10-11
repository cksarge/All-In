import { useNavigate, useParams } from 'react-router-dom';
import { SlotMachine } from '@/components/slots/SlotMachine';
import { BaccaratGame } from '@/components/solo/BaccaratGame';
import { KenoGame } from '@/components/solo/KenoGame';
import { PaiGowGame } from '@/components/solo/PaiGowGame';
import { SicBoGame } from '@/components/solo/SicBoGame';
import { ThreeCardGame } from '@/components/solo/ThreeCardGame';
import { VideoPokerGame } from '@/components/solo/VideoPokerGame';
import { WheelGame } from '@/components/solo/WheelGame';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/States';

/** /play/:gameKey: solo games (no table to join). */
export default function PlayPage() {
  const { gameKey = '' } = useParams();
  const navigate = useNavigate();
  if (gameKey.startsWith('slots_')) return <SlotMachine key={gameKey} gameKey={gameKey} />;
  if (gameKey.startsWith('video_poker_')) return <VideoPokerGame key={gameKey} gameKey={gameKey} />;
  if (gameKey === 'baccarat') return <BaccaratGame />;
  if (gameKey === 'three_card_poker') return <ThreeCardGame />;
  if (gameKey === 'pai_gow_poker') return <PaiGowGame />;
  if (gameKey === 'sic_bo') return <SicBoGame />;
  if (gameKey === 'keno') return <KenoGame />;
  if (gameKey === 'money_wheel') return <WheelGame />;
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
