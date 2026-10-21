import { useMemo } from 'react';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import type { LyricProviderSource } from '../types';
import { LYRIC_SOURCES } from '../utils/lyrics/lyricSources';

// src/hooks/useLyricMatchSources.ts
// The lyric sources on offer now: the tabs of the match dialogs and the choices of the priority
// setting. A source that needs an account comes and goes with that account's sign-in; a source that
// only aligns lines another source gave (Whisper) is never on offer here — there is nothing to
// search on it and no point preferring it, the automatic pick reaches it on its own.
export const useLyricMatchSources = (): LyricProviderSource[] => {
    const signedIn = useOnlineProviderAccountStore(state => (
        LYRIC_SOURCES.filter(source => source.needsAccount && state.accounts[source.id]?.user).map(source => source.id).join()
    ));
    return useMemo(() => {
        const ready = signedIn.split(',');
        return LYRIC_SOURCES
            .filter(source => !source.alignsOnly && (!source.needsAccount || ready.includes(source.id)))
            .map(source => source.id);
    }, [signedIn]);
};
