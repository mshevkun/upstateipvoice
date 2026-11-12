export const choices = [
    { id: 'opening', title: 'Opening a new practice', description: 'Build the right setup from day one', scene: 'A fresh start', note: 'A thoughtful foundation for what comes next.' },
    { id: 'improving', title: 'Improving an existing setup', description: 'Fix costs, missed calls, and transfers', scene: 'An established practice', note: 'Explore the touchpoints that keep your practice connected.' },
    { id: 'adding', title: 'Adding a location', description: 'Connect another office to your team', scene: 'Adding a location', note: 'One architectural family. More possibilities.' },
] as const;
export type Mode = typeof choices[number]['id'];
export type SceneMode = Mode | 'welcome';
export interface Plan {
    version: 1;
    planningMode: Mode | null;
}
export const storageKey = 'upstate.practice-plan.v1';
export function readPlan(): Plan {
    try {
        const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
        if (value.version === 1 && choices.some(c => c.id === value.planningMode))
            return { version: 1, planningMode: value.planningMode };
    }
    catch { /* Private browsing and corrupt storage leave an editable in-memory plan. */ }
    return { version: 1, planningMode: null };
}
export function savePlan(plan: Plan): boolean {
    try {
        localStorage.setItem(storageKey, JSON.stringify(plan));
        return true;
    }
    catch {
        return false;
    }
}
