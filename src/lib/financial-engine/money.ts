export function getActualDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Calcula em qual mês de fatura uma compra de cartão de crédito cai,
 * validando parâmetros de dia (1-31) e respeitando anos bissextos e viradas de ano.
 * Lança erro explícito para datas inválidas.
 */

/**
 * Distribui percentuais inteiros garantindo matematicamente que a soma resulte em exatamente 100%
 * através do Largest Remainder Method (Método do Maior Resto / Hamilton-Hare).
 */
export function calculateIntegerPercentages(
  items: { id: string; amount: number }[],
  totalAmount: number
): Map<string, number> {
  const resultMap = new Map<string, number>();
  if (!items || items.length === 0) {
    return resultMap;
  }

  // Sanitiza montantes: filtra valores não finitos ou negativos tratando como 0
  const validItems = items.map((i) => ({
    id: i.id,
    amount: Number.isFinite(i.amount) && i.amount > 0 ? i.amount : 0,
  }));

  const sumAmounts = validItems.reduce((acc, i) => acc + i.amount, 0);

  // Se a soma de todos os itens for 0 ou o total for inválido, retorna 0 para todos
  if (sumAmounts <= 0 || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    validItems.forEach((i) => resultMap.set(i.id, 0));
    return resultMap;
  }

  // Base de cálculo: se a soma das fatias divergir do totalAmount além de tolerância de 5 centavos,
  // normaliza pela soma real das fatias para garantir partição estrita de 100%
  const effectiveTotal = Math.abs(sumAmounts - totalAmount) > 0.05 ? sumAmounts : totalAmount;

  // 1. Calcula piso inteiro e resto fracionário de cada item
  const withRemainders = validItems.map((item) => {
    const exact = (item.amount / effectiveTotal) * 100;
    const floorVal = Math.floor(exact);
    const remainder = exact - floorVal;
    return { id: item.id, floorVal, remainder };
  });

  const floorSum = withRemainders.reduce((acc, i) => acc + i.floorVal, 0);
  let diff = 100 - floorSum;

  // 2. Ordena pelos maiores restos decrescentes e distribui a diferença
  const sorted = [...withRemainders].sort((a, b) => b.remainder - a.remainder);
  for (const item of sorted) {
    let finalVal = item.floorVal;
    if (diff > 0) {
      finalVal += 1;
      diff -= 1;
    }
    resultMap.set(item.id, finalVal);
  }

  return resultMap;
}

/**
 * Resolve ou cria fatura de cartão de crédito deterministicamente.
 * Se a fatura já existe pelo par (cardId, referenceMonth, workspaceId),
 * incrementa o total e retorna o ID real existente (b.id).
 * Se não existir, cria a nova fatura e retorna targetBillId.
 */
/**
 * Converte um valor monetário (em reais/unidade principal) para centavos inteiros.
 * Política de Decimais (V36 / P0-02): Adota arredondamento determinístico comercial (half-up / round-to-nearest)
 * universal através de notação exponencial decimal (`Math.round(Number(base + 'e' + targetExp))`),
 * imune a variações de escala de float drift IEEE 754 (ex: 10.075 -> 1008 centavos / R$ 10,08; 1.005 -> 101 centavos / R$ 1,01).
 * Trata nativamente notações científicas existentes (ex: 1e-7, 1e21) sem gerar NaN, normaliza valores subcentavos
 * (< 0.005) para 0 centavos, valida Number.isSafeInteger e normaliza -0 para 0.
 */
export function toCents(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) return 0;
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);

  // Valores subcentavos (< 0.005) arredondam para 0 centavos
  if (abs < 0.005) return 0;

  // Limite de segurança de representação inteira em centavos
  if (abs * 100 > Number.MAX_SAFE_INTEGER) return 0;

  return sign * Math.round(Number(`${abs}e2`));
}

/**
 * Converte centavos inteiros de volta para valor monetário float com até 2 casas decimais.
 */
export function fromCents(cents: number): number {
  if (typeof cents !== 'number' || !Number.isFinite(cents) || cents === 0) return 0;
  const roundedCents = Math.round(cents);
  if (!Number.isSafeInteger(roundedCents)) return 0;
  const val = roundedCents / 100;
  return Object.is(val, -0) ? 0 : val;
}

/**
 * Arredonda de forma pura e determinística qualquer montante monetário para 2 casas decimais.
 * Utiliza a política institucional de centavos inteiros half-up.
 */
export function roundCurrency(amount: number): number {
  return fromCents(toCents(amount));
}

/**
 * Compara dois valores monetários operando estritamente em centavos inteiros.
 * Retorna > 0 se a > b, < 0 se a < b, e 0 se a === b dentro da precisão de centavos.
 */
export function compareCurrency(a: number, b: number): number {
  return toCents(a) - toCents(b);
}
