import { describe, expect, it } from 'vitest';
import {
    buildLyricSourceOrder,
    migratePreferredLyricSource,
} from '@/utils/lyrics/sourcePriority';

// test/unit/lyrics/sourcePriority.test.ts

describe('lyric source priority', () => {
    it('defaults to QQ and retains every fallback exactly once', () => {
        // fork: 'whisper' is the local word-by-word alignment source, always tried last after every online source.
        expect(buildLyricSourceOrder()).toEqual(['qq', 'netease', 'amll', 'kugou', 'whisper']);
        expect(buildLyricSourceOrder('kugou')).toEqual(['kugou', 'netease', 'amll', 'qq', 'whisper']);
        expect(buildLyricSourceOrder('netease')).toEqual(['netease', 'amll', 'qq', 'kugou', 'whisper']);
        expect(buildLyricSourceOrder('amll')).toEqual(['amll', 'netease', 'qq', 'kugou', 'whisper']);
    });

    it('migrates missing, invalid, and legacy NetEase preferences to QQ', () => {
        expect(migratePreferredLyricSource(null, null)).toBe('qq');
        expect(migratePreferredLyricSource(null, 'netease')).toBe('qq');
        expect(migratePreferredLyricSource(null, 'invalid')).toBe('qq');
        expect(migratePreferredLyricSource('invalid', 'kugou')).toBe('qq');
    });

    it('preserves other legacy values and trusts the versioned preference thereafter', () => {
        expect(migratePreferredLyricSource(null, 'amll')).toBe('amll');
        expect(migratePreferredLyricSource(null, 'qq')).toBe('qq');
        expect(migratePreferredLyricSource(null, 'kugou')).toBe('kugou');
        expect(migratePreferredLyricSource('netease', 'qq')).toBe('netease');
    });
});
