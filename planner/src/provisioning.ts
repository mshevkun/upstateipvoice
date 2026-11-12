import type { Plan } from './config';
import { directory } from './policy';

/** One SIP identity. People, devices, extensions and concurrent answering capacity are not the same thing. */
export type Identity = {
    extension: string;
    label: string;
    team: string;
    device: string;
    access: 'outside' | 'internal';
    placementId: string;
    sharing: 'shared' | 'separate' | 'undecided';
    registrations: number;
    concurrent: number;
};

export type ProvisionGroup = {
    placementId: string;
    label: string;
    team: string;
    device: string;
    access: 'outside' | 'internal';
    sharing: 'shared' | 'separate' | 'undecided';
    deviceCount: number;
    base: string;
    extensions: string[];
    concurrent: number;
    suggested: boolean;
    note: string;
};

export type ProvisioningMap = {
    groups: ProvisionGroup[];
    identities: Identity[];
};

function baseFor(p: Plan, extension: string, index: number) {
    return extension || String(p.policy.extensionBase + index * 10);
}

export function provisioningMap(p: Plan): ProvisioningMap {
    const groups: ProvisionGroup[] = [];
    const identities: Identity[] = [];
    directory(p).forEach((d, i) => {
        const placement = p.policy.placements.find(x => x.id === d.id);
        const sharing = placement?.sharing || 'shared';
        const base = baseFor(p, d.extension, i);
        const count = d.count;
        if (sharing === 'separate' && count > 1) {
            const extensions = Array.from({ length: count }, (_, n) => String(Number(base) + n));
            groups.push({
                placementId: d.id, label: d.label, team: d.team, device: d.device, access: d.access as Identity['access'],
                sharing, deviceCount: count, base, extensions, concurrent: count, suggested: d.suggested,
                note: `${count} independently managed extensions (${extensions.join(', ')}). Each can answer at the same time.`
            });
            extensions.forEach((extension, n) => identities.push({
                extension, label: `${d.label} ${n + 1}`, team: d.team, device: d.device, access: d.access as Identity['access'],
                placementId: d.id, sharing, registrations: 1, concurrent: 1
            }));
            return;
        }
        if (sharing === 'undecided' && count > 1) {
            groups.push({
                placementId: d.id, label: d.label, team: d.team, device: d.device, access: d.access as Identity['access'],
                sharing, deviceCount: count, base, extensions: [base], concurrent: 0, suggested: d.suggested,
                note: `Sharing undecided for ${count} ${d.device} devices. Choose independent answering positions or one shared identity before provisioning.`
            });
            return;
        }
        const registrations = Math.max(1, count);
        groups.push({
            placementId: d.id, label: d.label, team: d.team, device: d.device, access: d.access as Identity['access'],
            sharing: sharing === 'undecided' ? 'shared' : sharing, deviceCount: count, base, extensions: [base], concurrent: 1, suggested: d.suggested,
            note: count > 1
                ? `${count} devices register as extension ${base}. That is one answering identity and one concurrent answer, not ${count} independently managed phones.`
                : `One SIP identity (${base}) for this position.`
        });
        identities.push({
            extension: base, label: d.label, team: d.team, device: d.device, access: d.access as Identity['access'],
            placementId: d.id, sharing: sharing === 'undecided' ? 'shared' : sharing, registrations, concurrent: 1
        });
    });
    return { groups, identities };
}

export function mappingPreview(p: Plan) {
    return provisioningMap(p).groups.map(g => `${g.label}: ${g.note}`);
}

export function ringMembers(p: Plan, team: string, outside = true) {
    return provisioningMap(p).identities.filter(x => x.team === team && (!outside || x.access === 'outside'));
}
