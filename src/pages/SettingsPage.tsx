import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/stores/authStore';
import { useUi } from '@/stores/uiStore';

/** Old /settings links: open the settings popup over the lounge (or home). */
export default function SettingsPage() {
  const status = useAuth((s) => s.status);
  const openSettings = useUi((s) => s.openSettings);
  useEffect(() => openSettings(), [openSettings]);
  if (status === 'loading') return null;
  return <Navigate to={status === 'signedIn' ? '/lounge' : '/'} replace />;
}
