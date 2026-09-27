import { describe, expect, it } from 'vitest';
import { parseSupabaseQueryOutput } from '../../../scripts/parse-supabase-query-output.mjs';

describe('Supabase CLI query output', () => {
  const summary = { ran: 23, planned: 23, failed: 0, finish_diagnostics: [] };

  it('aceita o array JSON retornado pela CLI no Linux', () => {
    expect(parseSupabaseQueryOutput(JSON.stringify([summary])).rows).toEqual([summary]);
  });

  it('aceita o objeto com rows retornado pela CLI no Windows', () => {
    const output = `Initialising login role...\n${JSON.stringify({ rows: [summary] })}`;
    expect(parseSupabaseQueryOutput(output).rows).toEqual([summary]);
  });

  it('rejeita saída tabular não solicitada', () => {
    expect(() => parseSupabaseQueryOutput('│ ran │ planned │')).toThrow(/não contém JSON/);
  });
});
