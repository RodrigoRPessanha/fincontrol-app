import {
  Account,
  Category,
  CreditCard,
  CreditCardBill,
  PaymentMethod,
  RecurringTransaction,
  Transaction,
} from '../types';
import {
  format,
  parseISO,
  isValid,
  addDays,
  addMonths,
  startOfMonth,
  endOfMonth,
  isBefore,
  isSameDay,
} from 'date-fns';
import { toCents, getActualDaysInMonth } from './money';
import { resolveCategory } from './categories';
import { resolveTransactionAccountId, validateTransactionBusinessRules } from './transactions';
import {
  validateCreditCardResolution,
  calculateCardBillDates,
  resolveOrCreateCreditCardBill,
} from './credit-cards';

/**
 * Valida de forma estrita o intervalo em dias para recorrências customizadas.
 * Exige número finito, inteiro positivo e limite máximo de 3.650 dias (10 anos).
 */
export function isValidCustomInterval(days: unknown): boolean {
  return typeof days === 'number' && Number.isFinite(days) && Number.isInteger(days) && days > 0 && days <= 3650;
}

/**
 * Calcula a data exata da ocorrência N a partir da data âncora inicial,
 * preservando o dia original (ex: dia 31) com clamp seguro nos meses menores (sem drift permanente).
 */
export function getAnchoredOccurrenceDate(startDateStr: string, monthsToAdd: number): string {
  if (!startDateStr || typeof startDateStr !== 'string') {
    throw new Error('Data inicial de recorrência inválida.');
  }

  const startDate = parseISO(startDateStr);
  if (!isValid(startDate)) {
    throw new Error(`Data de início de recorrência inválida: "${startDateStr}".`);
  }

  const safeMonths = Math.max(0, Math.floor(monthsToAdd || 0));
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1; // 1-12
  const anchorDay = startDate.getDate();

  let targetYear = startYear + Math.floor((startMonth - 1 + safeMonths) / 12);
  let targetMonth = ((startMonth - 1 + safeMonths) % 12) + 1;

  const maxDays = getActualDaysInMonth(targetYear, targetMonth);
  const realDay = Math.min(anchorDay, maxDays);

  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(realDay).padStart(2, '0')}`;
}

/**
 * Calcula a quantidade real de ocorrências de uma recorrência em um mês específico
 * utilizando datas civis reais e comparação rigorosa de end_date no nível de dia.
 */
export function isRecurrenceActiveInMonth(
  rec: RecurringTransaction,
  targetYear: number,
  targetMonth: number // 1-12
): { active: boolean; multiplier: number } {
  if (!rec.active) return { active: false, multiplier: 0 };

  const targetMonthKey = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
  const startMonthKey = rec.start_date.slice(0, 7);

  if (targetMonthKey < startMonthKey) return { active: false, multiplier: 0 };

  const startDate = parseISO(rec.start_date);
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1;
  const monthsDiff = (targetYear - startYear) * 12 + (targetMonth - startMonth);

  const monthStart = startOfMonth(new Date(targetYear, targetMonth - 1, 1));
  const monthEnd = endOfMonth(new Date(targetYear, targetMonth - 1, 1));

  switch (rec.frequency) {
    case 'weekly': {
      let occurrences = 0;
      let curr = parseISO(rec.start_date);

      while (isBefore(curr, monthStart)) {
        curr = addDays(curr, 7);
      }

      while (
        (isBefore(curr, monthEnd) || isSameDay(curr, monthEnd)) &&
        (!rec.end_date || isBefore(curr, parseISO(rec.end_date)) || isSameDay(curr, parseISO(rec.end_date)))
      ) {
        occurrences++;
        curr = addDays(curr, 7);
      }

      return { active: occurrences > 0, multiplier: occurrences };
    }

    case 'monthly':
    case 'bimonthly':
    case 'quarterly':
    case 'semiannual':
    case 'annual': {
      const step =
        rec.frequency === 'monthly'
          ? 1
          : rec.frequency === 'bimonthly'
          ? 2
          : rec.frequency === 'quarterly'
          ? 3
          : rec.frequency === 'semiannual'
          ? 6
          : 12;

      if (monthsDiff < 0 || monthsDiff % step !== 0) {
        return { active: false, multiplier: 0 };
      }

      const occurrenceDateStr = getAnchoredOccurrenceDate(rec.start_date, monthsDiff);
      if (rec.end_date && occurrenceDateStr > rec.end_date) {
        return { active: false, multiplier: 0 };
      }

      return { active: true, multiplier: 1 };
    }

    case 'custom': {
      if (!isValidCustomInterval(rec.interval_days)) {
        return { active: false, multiplier: 0 };
      }
      const interval = rec.interval_days as number;
      let occurrences = 0;
      let curr = parseISO(rec.start_date);

      while (isBefore(curr, monthStart)) {
        curr = addDays(curr, interval);
      }

      while (
        (isBefore(curr, monthEnd) || isSameDay(curr, monthEnd)) &&
        (!rec.end_date || isBefore(curr, parseISO(rec.end_date)) || isSameDay(curr, parseISO(rec.end_date)))
      ) {
        occurrences++;
        curr = addDays(curr, interval);
      }

      return { active: occurrences > 0, multiplier: occurrences };
    }

    default:
      return { active: true, multiplier: 1 };
  }
}

/**
 * Saneamento idempotente de séries recorrentes legadas (ex: V20 com income + cartão).
 * Marca qualquer série inválida como inativa com suspended_reason.
 */
export function sanitizeLegacyRecurringState(
  recurring: RecurringTransaction[],
  paymentMethods: PaymentMethod[]
): { sanitized: RecurringTransaction[]; hasChanges: boolean } {
  let hasChanges = false;
  const sanitized = recurring.map((rec) => {
    if (rec.type === 'income') {
      const pm = rec.payment_method_id
        ? paymentMethods.find((p) => p.id === rec.payment_method_id && p.workspace_id === rec.workspace_id)
        : null;
      const isCardMethod = pm && (pm.type === 'credit_card' || pm.credit_card_id);
      if (rec.credit_card_id || isCardMethod) {
        if (rec.active || !rec.suspended_reason) {
          hasChanges = true;
          return {
            ...rec,
            active: false,
            suspended_reason: 'Receitas não podem ser vinculadas a cartão de crédito ou faturas.',
          };
        }
      }
    }
    return rec;
  });

  return { sanitized, hasChanges };
}

/**
 * Validação estrita do valor monetário de recorrência.
 */
export function validateRecurringAmount(amount: unknown): void {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('O valor da recorrência deve ser maior que zero.');
  }
}

export interface RecurringMaterializationValidationResult {
  isValid: boolean;
  effectiveCardId?: string | null;
  effectiveAccountId?: string | null;
  reason?: string | null;
}

/**
 * Validação pura de integridade para materialização de recorrência.
 */
export function validateRecurringMaterialization(
  rec: RecurringTransaction,
  accounts: Account[],
  paymentMethods: PaymentMethod[],
  creditCards: CreditCard[],
  categories: Category[],
  workspaceId: string
): RecurringMaterializationValidationResult {
  try {
    validateRecurringAmount(rec.amount);

    const effectiveAccountId = resolveTransactionAccountId(
      rec.payment_method_id,
      rec.account_id,
      paymentMethods,
      workspaceId
    );

    if (effectiveAccountId) {
      const acc = accounts.find((a) => a.id === effectiveAccountId && a.workspace_id === workspaceId);
      if (!acc) {
        return { isValid: false, reason: 'Conta bancária associada não encontrada no workspace.' };
      }
      if (acc.active === false) {
        return { isValid: false, reason: 'Conta bancária vinculada está inativa.' };
      }
    }

    if (rec.category_id) {
      const cat = categories.find(
        (c) =>
          (c.id === rec.category_id || c.subcategories?.some((s) => s.id === rec.category_id)) &&
          c.workspace_id === workspaceId
      );
      if (!cat || cat.active === false) {
        return { isValid: false, reason: 'Categoria vinculada inativa ou inválida.' };
      }
      if (cat.id !== rec.category_id) {
        const sub = cat.subcategories?.find((s) => s.id === rec.category_id);
        if (sub && sub.active === false) {
          return { isValid: false, reason: 'A subcategoria informada está inativa.' };
        }
      }
    }

    const effectiveCardId = validateCreditCardResolution(
      workspaceId,
      paymentMethods,
      creditCards,
      accounts,
      rec.payment_method_id,
      rec.credit_card_id
    );

    validateTransactionBusinessRules(
      {
        type: rec.type,
        credit_card_id: effectiveCardId || rec.credit_card_id,
        payment_method_id: rec.payment_method_id,
        account_id: effectiveAccountId || rec.account_id,
      },
      paymentMethods,
      workspaceId
    );

    return { isValid: true, effectiveCardId, effectiveAccountId };
  } catch (err: any) {
    return {
      isValid: false,
      reason: err?.message || 'Inconsistência de integridade nas regras financeiras da recorrência.',
    };
  }
}

/**
 * Avança uma ocorrência de recorrência preservando âncora de dia do mês.
 */
export function stepNextOccurrence(
  currDateStr: string,
  startDateStr: string,
  frequency: string,
  intervalDays?: number | null
): string {
  const curr = parseISO(currDateStr);
  if (frequency === 'weekly') {
    return format(addDays(curr, 7), 'yyyy-MM-dd');
  }
  if (frequency === 'custom') {
    if (!isValidCustomInterval(intervalDays)) {
      throw new Error('Intervalo em dias inválido para recorrência personalizada (deve ser número inteiro entre 1 e 3650 dias).');
    }
    return format(addDays(curr, intervalDays as number), 'yyyy-MM-dd');
  }

  const start = parseISO(startDateStr);
  const anchorDay = start.getDate();

  const stepMonths =
    frequency === 'monthly'
      ? 1
      : frequency === 'bimonthly'
      ? 2
      : frequency === 'quarterly'
      ? 3
      : frequency === 'semiannual'
      ? 6
      : 12;

  let targetYear = curr.getFullYear();
  let targetMonth = curr.getMonth() + 1 + stepMonths;
  while (targetMonth > 12) {
    targetMonth -= 12;
    targetYear += 1;
  }

  const maxDays = getActualDaysInMonth(targetYear, targetMonth);
  const realDay = Math.min(anchorDay, maxDays);

  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(realDay).padStart(2, '0')}`;
}

/**
 * Avança ocorrência atrasada para o futuro de forma determinística sem backfill excessivo.
 */
export function calculateCatchUpOccurrence(
  currentNextOccurrence: string,
  startDate: string,
  frequency: string,
  intervalDays?: number | null,
  targetDateStr: string = format(new Date(), 'yyyy-MM-dd')
): string {
  if (currentNextOccurrence >= targetDateStr) return currentNextOccurrence;
  if (frequency === 'custom' && intervalDays && intervalDays > 0) {
    const startD = parseISO(startDate);
    const todayD = parseISO(targetDateStr);
    const diffDays = Math.max(0, Math.floor((todayD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)));
    const cycles = Math.ceil(diffDays / intervalDays);
    return format(addDays(startD, cycles * intervalDays), 'yyyy-MM-dd');
  }
  let curr = currentNextOccurrence;
  let count = 0;
  while (curr < targetDateStr && count < 1200) {
    curr = stepNextOccurrence(curr, startDate, frequency, intervalDays);
    count++;
  }
  return curr;
}

export interface ProcessRecurringBatchParams {
  recurring: RecurringTransaction[];
  transactions: Transaction[];
  bills: CreditCardBill[];
  accounts: Account[];
  paymentMethods: PaymentMethod[];
  creditCards: CreditCard[];
  categories: Category[];
  todayStr: string;
  generateId?: (prefix: string) => string;
  nowIso?: string;
}

export interface ProcessRecurringBatchResult {
  updatedRecurring: RecurringTransaction[];
  newTransactions: Transaction[];
  updatedBills: CreditCardBill[];
  hasChanges: boolean;
}

/**
 * Função pura de transição de estado para processamento em lote de recorrências.
 * Utilizada como única fonte de verdade tanto pelo FinanceProvider quanto pela suíte de testes.
 */
export function processRecurringBatchState(
  params: ProcessRecurringBatchParams
): ProcessRecurringBatchResult {
  const {
    recurring,
    transactions,
    bills,
    accounts,
    paymentMethods,
    creditCards,
    categories,
    todayStr,
    generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    nowIso = new Date().toISOString(),
  } = params;

  let updatedBills = [...bills];
  let updatedRecurring = [...recurring];
  const newTransactions: Transaction[] = [];
  let hasChanges = false;

  const processedSet = new Set<string>(
    transactions.map((t) => `${t.recurring_transaction_id || ''}:${t.transaction_date}`)
  );

  // Desativação semântica para qualquer série cujo next_occurrence já ultrapassou end_date
  updatedRecurring = updatedRecurring.map((r) => {
    if (r.active && r.end_date && r.next_occurrence > r.end_date) {
      hasChanges = true;
      return { ...r, active: false };
    }
    return r;
  });

  for (const rec of updatedRecurring) {
    if (!rec.active || !rec.auto_create || rec.next_occurrence > todayStr) continue;

    let currOccurrence = rec.next_occurrence;
    let iterations = 0;
    let shouldDeactivate = false;

    const validation = validateRecurringMaterialization(
      rec,
      accounts,
      paymentMethods,
      creditCards,
      categories,
      rec.workspace_id
    );

    if (!validation.isValid) {
      shouldDeactivate = true;
      hasChanges = true;
      updatedRecurring = updatedRecurring.map((r) =>
        r.id === rec.id ? { ...r, active: false, suspended_reason: validation.reason } : r
      );
      continue;
    }

    const effectiveCardId = validation.effectiveCardId || null;
    const effectiveAccountId = validation.effectiveAccountId || rec.account_id;

    while (
      currOccurrence <= todayStr &&
      (!rec.end_date || currOccurrence <= rec.end_date) &&
      iterations < 120
    ) {
      iterations++;
      const itemKey = `${rec.id}:${currOccurrence}`;

      if (!processedSet.has(itemKey)) {
        let billId: string | null = null;
        let calculatedDueDate = currOccurrence;

        if (effectiveCardId) {
          const card = creditCards.find((c) => c.id === effectiveCardId && c.workspace_id === rec.workspace_id);
          if (card) {
            const billDates = calculateCardBillDates(currOccurrence, card.closing_day, card.due_day);
            const billRes = resolveOrCreateCreditCardBill({
              bills: updatedBills,
              cardId: card.id,
              referenceMonth: billDates.referenceMonth,
              closingDate: billDates.closingDate,
              dueDate: billDates.dueDate,
              amount: rec.amount,
              workspaceId: rec.workspace_id,
              isPaid: false,
              nowIso,
            });
            updatedBills = billRes.updatedBills;
            billId = billRes.billId;
            hasChanges = true;
            calculatedDueDate = billDates.dueDate;
          }
        }

        const newTx: Transaction = {
          id: generateId('tx-rec'),
          workspace_id: rec.workspace_id,
          account_id: effectiveAccountId,
          category_id: rec.category_id,
          payment_method_id: rec.payment_method_id,
          credit_card_id: effectiveCardId || undefined,
          credit_card_bill_id: billId || undefined,
          recurring_transaction_id: rec.id,
          description: rec.description,
          amount: rec.amount,
          type: rec.type,
          transaction_date: currOccurrence,
          due_date: calculatedDueDate,
          status: 'pending',
          paid_amount: 0,
          created_at: nowIso,
        };
        newTransactions.push(newTx);
        processedSet.add(itemKey);
        hasChanges = true;
      }

      const nextStep = stepNextOccurrence(currOccurrence, rec.start_date, rec.frequency, rec.interval_days);
      if (rec.end_date && nextStep > rec.end_date) {
        shouldDeactivate = true;
        currOccurrence = nextStep;
        break;
      }
      currOccurrence = nextStep;
    }

    if (rec.next_occurrence !== currOccurrence || shouldDeactivate) {
      hasChanges = true;
      updatedRecurring = updatedRecurring.map((r) =>
        r.id === rec.id
          ? {
              ...r,
              next_occurrence: currOccurrence,
              active: shouldDeactivate ? false : r.active,
            }
          : r
      );
    }
  }

  return {
    updatedRecurring,
    newTransactions,
    updatedBills,
    hasChanges,
  };
}
