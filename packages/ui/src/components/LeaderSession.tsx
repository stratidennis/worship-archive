import { createContext, useContext } from 'react';
import { useT } from '../lib/i18n.js';
import { useLeading } from '../lib/leading.js';
import { useSession, type Session } from '../lib/useSession.js';

/**
 * The leader's connection, held above the router.
 *
 * One socket for as long as the switch is on, wherever you happen to navigate — see
 * `leading.ts` for why that is not the set page's business. The connection still only
 * exists while somebody is actually leading: mounted here, but `enabled` is false until
 * then, so an app merely being used does not put a phantom leader in everyone's device
 * list.
 */
const LeaderSessionContext = createContext<Session | null>(null);

export function LeaderSessionProvider({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const { setId } = useLeading();
  const session = useSession('leader', t('lead.roleLeader'), setId !== null);
  return (
    <LeaderSessionContext.Provider value={session}>{children}</LeaderSessionContext.Provider>
  );
}

export function useLeaderSession(): Session {
  const session = useContext(LeaderSessionContext);
  if (!session) {
    throw new Error('useLeaderSession must be used inside <LeaderSessionProvider>');
  }
  return session;
}
