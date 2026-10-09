export function parseSupabaseQueryOutput(rawOutput) {
  const text = rawOutput.trim();
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    // Some CLI versions prepend status text to the JSON response.
    const match = text.match(/\{[\s\S]*"rows"[\s\S]*\}/);
    if (!match) {
      throw new Error('A resposta da CLI não contém JSON com os resultados da consulta.');
    }
    parsed = JSON.parse(match[0]);
  }

  if (Array.isArray(parsed)) {
    return { rows: parsed };
  }
  if (parsed && typeof parsed === 'object' &&
      (Array.isArray(parsed.rows) || parsed.error || parsed._tag === 'Error')) {
    return parsed;
  }
  throw new Error('A resposta da CLI não contém linhas nem erro estruturado.');
}
