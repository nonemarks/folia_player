import React, { useEffect, useState } from 'react';
import { Check, Download, ExternalLink, Loader2, RefreshCw, Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/types';
import { useModsStore } from '../useModsStore';
import type { ModManagerClasses } from './modManagerClasses';

const MARKET_ORIGIN = 'https://folium-compound.cielaniska.top';
const CATALOG_URL = `${MARKET_ORIGIN}/catalog.json`;

type MarketMod = {
    id: string;
    name: string;
    version: string;
    author: string;
    description: string;
    origin: 'official' | 'community';
    permissions: string[];
    experimental: string[];
    download: { url: string; fileName: string; size: number; sha256: string };
    preview?: { url: string; width: number; height: number };
};

type ModMarketProps = {
    classes: ModManagerClasses;
    isDaylight: boolean;
    theme: Theme | null;
    canInstall: boolean;
    onClose: () => void;
};

const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

export const ModMarket: React.FC<ModMarketProps> = ({ classes, isDaylight, theme, canInstall, onClose }) => {
    const { t } = useTranslation();
    const installed = useModsStore((state) => state.mods);
    const install = useModsStore((state) => state.downloadMarketMod);
    const [mods, setMods] = useState<MarketMod[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [installing, setInstalling] = useState<string | null>(null);
    const [installError, setInstallError] = useState<string | null>(null);

    const loadCatalog = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(CATALOG_URL, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json() as { version: number; mods: MarketMod[] };
            if (payload.version !== 1 || !Array.isArray(payload.mods)) throw new Error('Invalid catalog');
            setMods(payload.mods);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void loadCatalog(); }, []);

    const handleInstall = async (mod: MarketMod) => {
        setInstalling(mod.id);
        setInstallError(null);
        try {
            const result = await install({ url: mod.download.url, sha256: mod.download.sha256, fileName: mod.download.fileName });
            if (!result.ok) setInstallError(result.error ?? 'install-failed');
        } finally {
            setInstalling(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/55 p-3 backdrop-blur-md" onClick={onClose}>
            <div className={`flex max-h-[min(860px,calc(100vh-24px))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border ${classes.card}`} onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--border-primary)' }}>
                    <div className="flex items-center gap-2">
                        <Store size={18} style={{ color: theme?.accentColor ?? 'var(--text-primary)' }} />
                        <div>
                            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('mods.market')}</h2>
                            <p className="text-[11px] opacity-55" style={{ color: 'var(--text-secondary)' }}>{t('mods.marketSubtitle')}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={() => { void loadCatalog(); }} className="rounded-lg p-2 opacity-65 hover:opacity-100" title={t('mods.marketRefresh')}>
                            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <a href={MARKET_ORIGIN} target="_blank" rel="noopener noreferrer" className="rounded-lg p-2 opacity-65 hover:opacity-100" title={t('mods.marketOpenWebsite')}>
                            <ExternalLink size={15} />
                        </a>
                        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xs opacity-65 hover:opacity-100">{t('close')}</button>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {loading && mods.length === 0 ? <div className="flex justify-center py-16 opacity-60"><Loader2 size={24} className="animate-spin" /></div> : null}
                    {error ? <div className={`rounded-xl border px-4 py-3 text-sm ${classes.danger}`}>{t('mods.marketLoadFailed')}: {error}</div> : null}
                    {installError ? <div className={`mb-3 rounded-xl border px-4 py-3 text-sm ${classes.danger}`}>{t('mods.installFailed')}: {installError}</div> : null}
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {mods.map((mod) => {
                            const isInstalled = installed.some((item) => item.id === mod.id);
                            const isInstalling = installing === mod.id;
                            return (
                                <article key={mod.id} className={`overflow-hidden rounded-xl border ${classes.card}`}>
                                    {mod.preview ? <img src={`${MARKET_ORIGIN}${mod.preview.url}`} alt="" className="aspect-video w-full object-cover" loading="lazy" /> : null}
                                    <div className="space-y-2 p-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <h3 className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{mod.name}</h3>
                                                <p className="text-[11px] opacity-55" style={{ color: 'var(--text-secondary)' }}>{mod.id} · v{mod.version} · {mod.author}</p>
                                            </div>
                                            <span className="shrink-0 text-[10px] opacity-55">{mod.origin === 'official' ? t('mods.marketOfficial') : t('mods.marketCommunity')}</span>
                                        </div>
                                        <p className="line-clamp-3 text-xs leading-relaxed opacity-70" style={{ color: 'var(--text-secondary)' }}>{mod.description}</p>
                                        <div className="flex flex-wrap gap-1">
                                            {[...mod.permissions, ...mod.experimental.map((item) => `experimental:${item}`)].map((item) => <span key={item} className={`rounded px-1.5 py-0.5 text-[10px] ${classes.chip}`}>{item}</span>)}
                                        </div>
                                        <div className="flex items-center justify-between gap-2 pt-1">
                                            <span className="text-[10px] opacity-45">{formatSize(mod.download.size)}</span>
                                            <button type="button" disabled={!canInstall || isInstalling} onClick={() => { void handleInstall(mod); }} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40" style={{ borderColor: theme?.accentColor ?? 'var(--border-primary)', color: 'var(--text-primary)' }}>
                                                {isInstalling ? <Loader2 size={12} className="animate-spin" /> : isInstalled ? <Check size={12} /> : <Download size={12} />}
                                                {isInstalling ? t('mods.marketInstalling') : isInstalled ? t('mods.marketInstalled') : t('mods.marketInstall')}
                                            </button>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ModMarket;