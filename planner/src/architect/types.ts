import type { Plan } from '../config';

export type Scalar = string | number | boolean | null;
export type FactStatus = 'unset' | 'confirmed' | 'uncertain' | 'skipped' | 'conflicting' | 'proposed';
export type InterpreterIntent =
    | 'provide_information'
    | 'ask_question'
    | 'skip_current'
    | 'correct_information'
    | 'generate_draft'
    | 'restart';
export type FieldOperation = 'set' | 'skip' | 'uncertain' | 'clear';

export type Fact = {
    field_id: string;
    value: Scalar;
    status: FactStatus;
    evidence: string;
};

export type InterpreterUpdate = {
    field_id: string;
    operation: FieldOperation;
    value: Scalar;
    evidence: string;
    needs_confirmation: boolean;
    precision?: 'exact' | 'heuristic';
};

export type InterpreterResponse = {
    acknowledgement: string;
    intent: InterpreterIntent;
    updates: InterpreterUpdate[];
    unmapped_facts: string[];
    explanation_topic: string | null;
};

export type Chip = {
    id: string;
    label: string;
    field_id: string;
    value: Scalar;
    operation: FieldOperation;
};

export type NextQuestion = {
    id: string;
    text: string;
    detail: string;
    options: Chip[];
    skipAllowed: boolean;
    affectedFields: string[];
    priority: number;
};

export type FieldCatalogEntry = {
    id: string;
    type: 'string' | 'number' | 'boolean' | 'enum';
    enum?: string[];
    min?: number;
    max?: number;
    description: string;
};

export type FieldDef = FieldCatalogEntry & {
    blocked?: boolean;
    confirmStep?: string;
    read: (p: Plan) => Scalar;
    apply: (p: Plan, operation: FieldOperation, value: Scalar) => Plan;
};

export type MergeResult = {
    plan: Plan;
    facts: Record<string, Fact>;
    accepted: InterpreterUpdate[];
    rejected: {
        update: InterpreterUpdate;
        reason: string;
    }[];
    confirmationNeeded: InterpreterUpdate[];
    futureConsiderations: string[];
    changed: boolean;
};

export type ConversationRecord = {
    sessionId: string;
    revision: number;
    facts: Record<string, Fact>;
    currentQuestionId: string | null;
    futureConsiderations: string[];
    messages: {
        id: string;
        role: 'user' | 'assistant';
        content: string;
        questionId?: string | null;
    }[];
};
