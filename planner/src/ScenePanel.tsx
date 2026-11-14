import { useEffect, useRef, useState } from 'react';
import { teamSummary, roles, roleInfo, roleState } from './team-state';
import type { Plan } from './config';
import type { SceneMode } from './state';
import type { PracticeScene } from './scene';

export function Scene({ p, simulation, mode, chapter, badge, indexLabel, sceneClass, showTeamLegend, showSpecialtyCaption }: {
    p: Plan;
    simulation: string;
    mode: SceneMode;
    chapter: number;
    badge: string;
    indexLabel: string;
    sceneClass?: string;
    showTeamLegend?: boolean;
    showSpecialtyCaption?: boolean;
}) {
    const mount = useRef<HTMLDivElement>(null), scene = useRef<PracticeScene | null>(null), latest = useRef({ p, chapter });
    latest.current = { p, chapter };
    const [status, setStatus] = useState('loading'), [expanded, setExpanded] = useState(false);
    useEffect(() => { let live = true; import('./scene').then(({ PracticeScene }) => { if (!live || !mount.current)
        return; try {
        if (new URLSearchParams(location.search).has('no3d'))
            throw Error('Fallback requested');
        scene.current = new PracticeScene(mount.current, () => { if (live) {
            setStatus('ready');
            scene.current?.setConfiguration(latest.current.p, latest.current.chapter);
        } }, () => { if (live)
            setStatus('fallback'); });
        scene.current.setMode(mode);
    }
    catch {
        setStatus('fallback');
    } }); return () => { live = false; scene.current?.dispose(); }; }, []);
    useEffect(() => { scene.current?.setMode(mode); scene.current?.setConfiguration(p, chapter); }, [mode, p, chapter]);
    useEffect(() => { scene.current?.setActivity(simulation); }, [simulation]);
    useEffect(() => { if (!expanded)
        return; const previous = document.activeElement as HTMLElement | null; const blocked = Array.from(document.querySelectorAll<HTMLElement>('.header,.conversation')); blocked.forEach(el => el.inert = true); const panel = mount.current?.closest('aside'); const buttons = () => Array.from(panel?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []); buttons().at(-1)?.focus(); const listener = (e: KeyboardEvent) => { if (e.key === 'Escape')
        setExpanded(false); if (e.key === 'Tab') {
        const list = buttons(), first = list[0], last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
        }
    } }; window.addEventListener('keydown', listener); return () => { window.removeEventListener('keydown', listener); blocked.forEach(el => el.inert = false); previous?.focus(); }; }, [expanded]);
    return <aside className={'scene-panel scene-only ' + (sceneClass || '') + (expanded ? ' expanded' : '')} aria-label="Practice visualization" role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined}><div className="scene-heading"><span className="scene-badge"><i />{badge}</span><span className="scene-index">{indexLabel}</span></div><div ref={mount} className="viewport" data-testid="scene" role="img" aria-label="Illustrative modular practice layout">{status !== 'ready' && <div className="fallback">{status === 'fallback' && <img src="/assets/practice-fallback.png" alt="Miniature practice reception"/>}<span>{status === 'loading' ? 'Preparing your practice…' : 'Static preview · all planning controls still work'}</span></div>}</div>{simulation && <div className="scene-call" role="status"><i /> {simulation}</div>}{showTeamLegend && <div className="role-legend" aria-label="Team counts">{roles.map(role => { const v = roleState(p, role); return v.status === 'known' ? <span className={'role-label ' + role} key={role + '-' + v.count}>{roleInfo[role].short} · {v.count}</span> : null; })}</div>}{showTeamLegend && sceneClass === 'team-scene' && <div className="team-caption" aria-live="polite"><span>Illustrative office. Your team size doesn’t set room or phone counts.</span><span className="sr-only">{teamSummary(p).label}</span></div>}{showSpecialtyCaption && <p className="illustrative-caption">Example space. Rooms and phones are chosen later.</p>}<div className="scene-tools"><span>Illustrative office layout</span><div><button disabled={status !== 'ready'} onClick={() => scene.current?.replay()} aria-label="Replay scene animation">↻ <span>Replay view</span></button><button onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Close expanded scene' : 'Expand scene'}>{expanded ? 'Close' : '⛶'}</button></div></div></aside>;
}
