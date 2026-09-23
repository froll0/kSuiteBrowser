import type { Session } from 'electron';
import type { BrowsingDataSelection } from '../shared/types';

/** Deletes the selected browsing data of a session. */
export async function clearBrowsingData(session: Session, selection: Pick<BrowsingDataSelection, 'cookies' | 'cache'>): Promise<void> {
  const tasks: Array<Promise<unknown>> = [];
  if (selection.cookies) {
    tasks.push(
      session.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'],
      }),
      session.clearAuthCache(),
    );
  }
  if (selection.cache) tasks.push(session.clearCache(), session.clearHostResolverCache(), session.clearCodeCaches({}));
  await Promise.all(tasks);
}
