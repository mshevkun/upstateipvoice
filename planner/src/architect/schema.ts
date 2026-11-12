/** Groq strict JSON schema. Optional values use null, never omitted keys. */
export const interpreterResponseSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        acknowledgement: { type: 'string' },
        intent: {
            type: 'string',
            enum: [
                'provide_information',
                'ask_question',
                'skip_current',
                'correct_information',
                'generate_draft',
                'restart'
            ]
        },
        updates: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    field_id: { type: 'string' },
                    operation: { type: 'string', enum: ['set', 'skip', 'uncertain', 'clear'] },
                    value: { type: ['string', 'number', 'boolean', 'null'] },
                    evidence: { type: 'string' },
                    needs_confirmation: { type: 'boolean' }
                },
                required: ['field_id', 'operation', 'value', 'evidence', 'needs_confirmation']
            }
        },
        unmapped_facts: {
            type: 'array',
            items: { type: 'string' }
        },
        explanation_topic: { type: ['string', 'null'] }
    },
    required: ['acknowledgement', 'intent', 'updates', 'unmapped_facts', 'explanation_topic']
} as const;

export const INTERPRETER_INTENTS = interpreterResponseSchema.properties.intent.enum;
