import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/** Invite links: /join/ABC123 seats you at the private table. */
export default function JoinPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void supabase.rpc('join_by_code', { p_code: code }).then(({ data, error: err }) => {
      if (err) setError(friendlyError(err));
      else navigate(`/table/${(data as { table_id: string }).table_id}`, { replace: true });
    });
  }, [code, navigate]);

  if (!error) return <FullPageLoader label="Joining your friends…" />;
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="surface">
        <ErrorState title="Couldn't join that table" message={error} />
        <div className="flex justify-center pb-6">
          <Button variant="outline" size="sm" onClick={() => navigate('/lobby')}>
            Go to the lobby
          </Button>
        </div>
      </div>
    </div>
  );
}
