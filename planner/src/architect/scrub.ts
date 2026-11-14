/** Strip personal phones, emails, DOBs, and patient names before Groq or storage. */

export type ScrubResult = { text: string; removed: boolean; kinds: string[] };

const PHONE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
const DOB = new RegExp('\\b(?:dob|date of birth|born)\\s*[:#]?\\s*(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|(?:' + MONTHS + ')\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})\\b', 'gi');
const DOB_BARE = /\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}\b/g;
const PATIENT = /\bpatient\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g;
const HONORIFIC = /\b(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+called\b/g;
const NAME_DOB = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+DOB\b/g;

export function scrubPii(input: string): ScrubResult {
    const kinds: string[] = [];
    let text = String(input || '');
    const mark = (re: RegExp, kind: string, replacement: string) => {
        re.lastIndex = 0;
        if (re.test(text))
            kinds.push(kind);
        re.lastIndex = 0;
        text = text.replace(re, replacement);
    };
    mark(EMAIL, 'email', '[email removed]');
    mark(PHONE, 'phone', '[number removed]');
    mark(NAME_DOB, 'dob', '[name removed] DOB');
    mark(DOB, 'dob', '[date removed]');
    mark(DOB_BARE, 'dob', '[date removed]');
    mark(PATIENT, 'patient', 'patient [name removed]');
    mark(HONORIFIC, 'patient', '[name removed] called');
    return { text: text.replace(/\s{2,}/g, ' ').trim(), removed: kinds.length > 0, kinds: [...new Set(kinds)] };
}

export function scrubAckNotice(kinds: string[]) {
    if (kinds.includes('phone'))
        return "I don't store personal numbers. We'll use a work on-call phone.";
    if (kinds.includes('email') || kinds.includes('dob') || kinds.includes('patient'))
        return "I don't store personal patient details.";
    return '';
}
