import {
  Person,
  Purchase,
  Settlement,
  SplitParticipant,
  SplitType,
  Transaction,
  TransactionSplit,
  WorkspaceMember,
} from '../types';
import { toCents, fromCents } from './money';

export interface MemberNetBalance {
  member_id: string;
  participant_id: string;
  participant_type: 'member' | 'person';
  name?: string;
  person_id?: string | null;
  total_paid: number;
  total_share: number;
  net_balance: number; // > 0: a receber (credor); < 0: a pagar (devedor)
}

export interface PairwiseDebt {
  from_member_id: string;
  to_member_id: string;
  amount: number;
  from_id?: string;
  to_id?: string;
  from_type?: 'member' | 'person';
  to_type?: 'member' | 'person';
  from_person_id?: string | null;
  to_person_id?: string | null;
}

/** Shared selection contract for chips, preview and financial submission. */
export function resolveSplitParticipants(
  members: WorkspaceMember[], people: Person[], selectedIds: string[], payerId: string
): SplitParticipant[] {
  const available: SplitParticipant[] = [
    ...members.map((m) => ({ id: m.id, type: 'member' as const, name: m.user?.name || m.user?.email?.split('@')[0] || `Membro ${m.id.substring(0, 4)}` })),
    ...people.map((p) => ({ id: p.id, type: 'person' as const, name: p.name })),
  ];
  const selected = selectedIds.length > 0
    ? available.filter((p) => selectedIds.includes(p.id))
    : members.length <= 1 && people.length > 0 ? available : available.filter((p) => p.type === 'member');
  const payer = available.find((p) => p.id === payerId);
  if (payer && !selected.some((p) => p.id === payerId)) selected.push(payer);
  return selected;
}

/**
 * Calcula a divisão determinística de uma despesa entre participantes (membros e/ou pessoas salvas) sem perda de centavos.
 */
export function calculateExpenseSplits(
  totalAmount: number,
  splitType: SplitType,
  members: (SplitParticipant | { id: string; type?: 'member' | 'person'; name?: string })[],
  payerMemberId: string | { id: string; type?: 'member' | 'person' },
  customSplits?: {
    member_id?: string | null;
    person_id?: string | null;
    id?: string;
    type?: 'member' | 'person';
    amount: number;
  }[]
): TransactionSplit[] {
  if (typeof totalAmount !== 'number' || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('O valor total da despesa para rateio deve ser maior que zero.');
  }
  if (!members || members.length === 0) {
    throw new Error('A lista de membros do workspace não pode estar vazia.');
  }

  const payerId = typeof payerMemberId === 'string' ? payerMemberId : payerMemberId.id;
  const participantMap = new Map<string, 'member' | 'person'>();
  const getType = (m: any): 'member' | 'person' =>
    m.type || (m.is_member === false || m.person_id ? 'person' : 'member');

  for (const m of members) {
    participantMap.set(m.id, getType(m));
  }

  if (!participantMap.has(payerId)) {
    throw new Error('O membro pagador deve pertencer à lista de membros do workspace.');
  }

  const payerType = typeof payerMemberId === 'string'
    ? (participantMap.get(payerId) as 'member' | 'person')
    : (payerMemberId.type || (participantMap.get(payerId) as 'member' | 'person'));

  const totalCents = toCents(totalAmount);

  const makeSplit = (id: string, type: 'member' | 'person', cents: number, pct: number): TransactionSplit => {
    const split: TransactionSplit = {
      amount: fromCents(cents),
      percentage: pct,
    };
    if (type === 'person') {
      split.person_id = id;
    } else {
      split.member_id = id;
    }
    return split;
  };

  if (splitType === 'individual') {
    return [makeSplit(payerId, payerType, totalCents, 100)];
  }

  if (splitType === 'equal') {
    const count = members.length;
    const baseCents = Math.floor(totalCents / count);
    const remainderCents = totalCents - baseCents * count;

    return members.map((m, idx) => {
      const cents = idx < remainderCents ? baseCents + 1 : baseCents;
      const pct = Math.round((cents / totalCents) * 1000) / 10;
      return makeSplit(m.id, getType(m), cents, pct);
    });
  }

  if (splitType === 'full_other') {
    const otherMembers = members.filter((m) => m.id !== payerId);
    if (otherMembers.length === 0) {
      return [makeSplit(payerId, payerType, totalCents, 100)];
    }
    const count = otherMembers.length;
    const baseCents = Math.floor(totalCents / count);
    const remainderCents = totalCents - baseCents * count;

    return otherMembers.map((m, idx) => {
      const cents = idx < remainderCents ? baseCents + 1 : baseCents;
      const pct = Math.round((cents / totalCents) * 1000) / 10;
      return makeSplit(m.id, getType(m), cents, pct);
    });
  }

  if (splitType === 'custom') {
    if (!customSplits || customSplits.length === 0) {
      return [makeSplit(payerId, payerType, totalCents, 100)];
    }

    const seenMembers = new Set<string>();
    const sanitized = customSplits.map((cs) => {
      const targetId = cs.person_id || cs.member_id || cs.id;
      if (!targetId || !participantMap.has(targetId)) {
        throw new Error('Todos os participantes do rateio devem pertencer aos membros do workspace.');
      }
      if (seenMembers.has(targetId)) {
        throw new Error('Membros duplicados identificados no rateio customizado.');
      }
      seenMembers.add(targetId);

      if (typeof cs.amount !== 'number' || !Number.isFinite(cs.amount) || cs.amount < 0) {
        throw new Error('O valor atribuído a cada membro no rateio não pode ser negativo.');
      }

      const targetType = cs.type || (participantMap.get(targetId) as 'member' | 'person');

      return {
        id: targetId,
        type: targetType,
        cents: toCents(cs.amount),
      };
    });

    const sumCents = sanitized.reduce((acc, c) => acc + c.cents, 0);
    if (sumCents !== totalCents) {
      throw new Error(
        `A soma das divisões (R$ ${(sumCents / 100).toFixed(2)}) diverge do valor total da despesa (R$ ${(totalCents / 100).toFixed(2)}).`
      );
    }
    return sanitized.map((s) => {
      const pct = Math.round((s.cents / totalCents) * 1000) / 10;
      return makeSplit(s.id, s.type, s.cents, pct);
    });
  }

  return [makeSplit(payerId, payerType, totalCents, 100)];
}

/**
 * Calcula o balanço líquido de cada membro e consolida dívidas recíprocas (estilo Splitwise).
 */
export function calculateMemberNetBalances(
  transactions: Transaction[],
  settlements: Settlement[],
  members: WorkspaceMember[],
  workspaceId: string,
  purchases?: Purchase[],
  people?: Person[]
): {
  balances: MemberNetBalance[];
  pairwiseDebts: PairwiseDebt[];
} {
  const wsMembers = members.filter((m) => m.workspace_id === workspaceId);
  const wsPeople = (people || []).filter((p) => p.workspace_id === workspaceId);

  interface ParticipantInfo {
    id: string;
    type: 'member' | 'person';
    name: string;
  }

  const participantsMap = new Map<string, ParticipantInfo>();

  wsMembers.forEach((m) => {
    const mAny = m as any;
    participantsMap.set(m.id, {
      id: m.id,
      type: 'member',
      name: mAny.profile?.full_name || mAny.user?.name || mAny.profile?.email || mAny.user?.email || 'Membro',
    });
  });

  wsPeople.forEach((p) => {
    participantsMap.set(p.id, {
      id: p.id,
      type: 'person',
      name: p.name,
    });
  });

  // Identifica participantes adicionais referenciados em transações, compras ou settlements
  const wsTransactions = transactions.filter(
    (t) => t.workspace_id === workspaceId && t.status !== 'cancelled' && t.type === 'expense'
  );

  for (const tx of wsTransactions) {
    if (tx.paid_by_person_id && !participantsMap.has(tx.paid_by_person_id)) {
      participantsMap.set(tx.paid_by_person_id, { id: tx.paid_by_person_id, type: 'person', name: 'Pessoa externa' });
    }
    for (const split of tx.splits || []) {
      if (split.person_id && !participantsMap.has(split.person_id)) {
        participantsMap.set(split.person_id, { id: split.person_id, type: 'person', name: 'Pessoa externa' });
      }
    }
  }

  const wsPurchases = (purchases || []).filter(
    (p) => p.workspace_id === workspaceId && p.splits && p.splits.length > 0
  );

  for (const pur of wsPurchases) {
    if (pur.paid_by_person_id && !participantsMap.has(pur.paid_by_person_id)) {
      participantsMap.set(pur.paid_by_person_id, { id: pur.paid_by_person_id, type: 'person', name: 'Pessoa externa' });
    }
    for (const split of pur.splits!) {
      if (split.person_id && !participantsMap.has(split.person_id)) {
        participantsMap.set(split.person_id, { id: split.person_id, type: 'person', name: 'Pessoa externa' });
      }
    }
  }

  const wsSettlements = settlements.filter((s) => s.workspace_id === workspaceId);
  for (const s of wsSettlements) {
    if (s.from_person_id && !participantsMap.has(s.from_person_id)) {
      participantsMap.set(s.from_person_id, { id: s.from_person_id, type: 'person', name: 'Pessoa externa' });
    }
    if (s.to_person_id && !participantsMap.has(s.to_person_id)) {
      participantsMap.set(s.to_person_id, { id: s.to_person_id, type: 'person', name: 'Pessoa externa' });
    }
  }

  const paidMap = new Map<string, number>();
  const shareMap = new Map<string, number>();
  const settledOutMap = new Map<string, number>();
  const settledInMap = new Map<string, number>();

  participantsMap.forEach((_, id) => {
    paidMap.set(id, 0);
    shareMap.set(id, 0);
    settledOutMap.set(id, 0);
    settledInMap.set(id, 0);
  });

  // 1. Despesas avulsas com rateio
  for (const tx of wsTransactions) {
    if (!tx.splits || tx.splits.length === 0) {
      continue;
    }

    const payerId = tx.paid_by_person_id || tx.paid_by_member_id || wsMembers[0]?.id;
    if (!payerId) continue;

    const txTotalCents = toCents(tx.amount);
    paidMap.set(payerId, (paidMap.get(payerId) || 0) + txTotalCents);

    for (const split of tx.splits) {
      const splitId = split.person_id || split.member_id;
      if (splitId) {
        const splitCents = toCents(split.amount);
        shareMap.set(splitId, (shareMap.get(splitId) || 0) + splitCents);
      }
    }
  }

  // 2. Compras parceladas com rateio (P0-02: consolidada no total da compra uma única vez, sem duplicar por parcela)
  for (const pur of wsPurchases) {
    const payerId = pur.paid_by_person_id || pur.paid_by_member_id || wsMembers[0]?.id;
    if (!payerId) continue;

    const purTotalCents = toCents(pur.total_amount);
    paidMap.set(payerId, (paidMap.get(payerId) || 0) + purTotalCents);

    for (const split of pur.splits!) {
      const splitId = split.person_id || split.member_id;
      if (splitId) {
        const splitCents = toCents(split.amount);
        shareMap.set(splitId, (shareMap.get(splitId) || 0) + splitCents);
      }
    }
  }

  // 3. Liquidações e acertos consolidados
  for (const s of wsSettlements) {
    const fromId = s.from_person_id || s.from_member_id;
    const toId = s.to_person_id || s.to_member_id;
    if (fromId && toId) {
      const sCents = toCents(s.amount);
      settledOutMap.set(fromId, (settledOutMap.get(fromId) || 0) + sCents);
      settledInMap.set(toId, (settledInMap.get(toId) || 0) + sCents);
    }
  }

  const balances: MemberNetBalance[] = Array.from(participantsMap.values()).map((p) => {
    const paid = paidMap.get(p.id) || 0;
    const share = shareMap.get(p.id) || 0;
    const settledOut = settledOutMap.get(p.id) || 0;
    const settledIn = settledInMap.get(p.id) || 0;

    const netCents = (paid - share) + (settledOut - settledIn);

    return {
      member_id: p.id,
      participant_id: p.id,
      participant_type: p.type,
      name: p.name,
      person_id: p.type === 'person' ? p.id : null,
      total_paid: fromCents(paid),
      total_share: fromCents(share),
      net_balance: fromCents(netCents),
    };
  });

  const creditors = balances
    .filter((b) => toCents(b.net_balance) > 0)
    .map((b) => ({ id: b.participant_id, type: b.participant_type, cents: toCents(b.net_balance) }))
    .sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id));

  const debtors = balances
    .filter((b) => toCents(b.net_balance) < 0)
    .map((b) => ({ id: b.participant_id, type: b.participant_type, cents: Math.abs(toCents(b.net_balance)) }))
    .sort((a, b) => b.cents - a.cents || a.id.localeCompare(b.id));

  const pairwiseDebts: PairwiseDebt[] = [];
  let cIdx = 0;
  let dIdx = 0;

  while (cIdx < creditors.length && dIdx < debtors.length) {
    const creditor = creditors[cIdx];
    const debtor = debtors[dIdx];

    const settleCents = Math.min(creditor.cents, debtor.cents);
    const debt: PairwiseDebt = {
      from_member_id: debtor.id,
      to_member_id: creditor.id,
      amount: fromCents(settleCents),
    };
    Object.defineProperties(debt, {
      from_id: { value: debtor.id, enumerable: false, writable: true },
      to_id: { value: creditor.id, enumerable: false, writable: true },
      from_type: { value: debtor.type, enumerable: false, writable: true },
      to_type: { value: creditor.type, enumerable: false, writable: true },
      from_person_id: { value: debtor.type === 'person' ? debtor.id : null, enumerable: false, writable: true },
      to_person_id: { value: creditor.type === 'person' ? creditor.id : null, enumerable: false, writable: true },
    });
    pairwiseDebts.push(debt);
    creditor.cents -= settleCents;
    debtor.cents -= settleCents;

    if (creditor.cents === 0) cIdx++;
    if (debtor.cents === 0) dIdx++;
  }

  return { balances, pairwiseDebts };
}

/**
 * Validação rigorosa de registro de liquidação de acerto de contas.
 */
export function validateSettlement(
  fromMemberId: string,
  toMemberId: string,
  amount: number,
  members: WorkspaceMember[],
  workspaceId: string,
  pairwiseDebts?: PairwiseDebt[],
  people?: Person[]
): void {
  if (!fromMemberId || !toMemberId) {
    throw new Error('Membros devedor e credor devem ser informados para o acerto.');
  }
  if (fromMemberId === toMemberId) {
    throw new Error('O membro pagador e o recebedor do acerto não podem ser a mesma pessoa.');
  }
  const amountCents = toCents(amount);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amountCents <= 0) {
    throw new Error('O valor do acerto deve ser maior que zero.');
  }
  const wsMembers = members.filter((m) => m.workspace_id === workspaceId);
  const wsPeople = (people || []).filter((p) => p.workspace_id === workspaceId);

  const isFromValid = wsMembers.some((m) => m.id === fromMemberId) || wsPeople.some((p) => p.id === fromMemberId);
  const isToValid = wsMembers.some((m) => m.id === toMemberId) || wsPeople.some((p) => p.id === toMemberId);

  if (!isFromValid || !isToValid) {
    throw new Error('Os membros participantes do acerto devem pertencer ao workspace ativo.');
  }

  if (pairwiseDebts) {
    const existingDebt = pairwiseDebts.find(
      (d) => d.from_member_id === fromMemberId && d.to_member_id === toMemberId
    );
    const maxCents = existingDebt ? toCents(existingDebt.amount) : 0;
    if (maxCents <= 0) {
      throw new Error('Não há débito pendente registrado entre o pagador e o recebedor informados.');
    }
    if (amountCents > maxCents) {
      throw new Error(
        `O valor do acerto (R$ ${(amountCents / 100).toFixed(2)}) excede a dívida pendente de R$ ${(maxCents / 100).toFixed(2)}.`
      );
    }
  }
}
