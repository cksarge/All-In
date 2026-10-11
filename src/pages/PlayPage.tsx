import { useNavigate, useParams } from 'react-router-dom';
import { SlotMachine } from '@/components/slots/SlotMachine';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/States';

/** /play/:gameKey: solo games (no table to join). */
export default function PlayPage() {
  const { gameKey = '' } = useParams();
  const navigate = useNavigate();
  if (gameKey.startsWith('slots_')) return <SlotMachine key={gameKey} gameKey={gameKey} />;
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
