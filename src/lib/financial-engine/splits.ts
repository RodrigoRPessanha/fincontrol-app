import {
  Purchase,
  Settlement,
  SplitType,
  Transaction,
  TransactionSplit,
  WorkspaceMember,
} from '../types';
import { toCents, fromCents, calculateIntegerPercentages } from './money';

export interface MemberNetBalance {
  member_id: string;
  total_paid: number;
  total_share: number;
  net_balance: number; // > 0: a receber (credor); < 0: a pagar (devedor)
}

export interface PairwiseDebt {
  from_member_id: string;
  to_member_id: string;
  amount: number;
}

/**
 * Calcula a divisão determinística de uma despesa entre membros do workspace sem perda de centavos.
 */
export function calculateExpenseSplits(
  totalAmount: number,
  splitType: SplitType,
  members: { id: string }[],
  payerMemberId: string,
  customSplits?: { member_id: string; amount: number }[]
): TransactionSplit[] {
  if (typeof totalAmount !== 'number' || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('O valor total da despesa para rateio deve ser maior que zero.');
  }
  if (!members || members.length === 0) {
    throw new Error('A lista de membros do workspace não pode estar vazia.');
  }

  const memberIds = new Set(members.map((m) => m.id));
  if (!memberIds.has(payerMemberId)) {
    throw new Error('O membro pagador deve pertencer à lista de membros do workspace.');
  }

  const totalCents = toCents(totalAmount);

  if (splitType === 'individual') {
    return [{ member_id: payerMemberId, amount: fromCents(totalCents), percentage: 100 }];
  }

  if (splitType === 'equal') {
    const count = members.length;
    const baseCents = Math.floor(totalCents / count);
    const remainderCents = totalCents - baseCents * count;

    return members.map((m, idx) => {
      const cents = idx < remainderCents ? baseCents + 1 : baseCents;
      const pct = Math.round((cents / totalCents) * 1000) / 10;
      return {
        member_id: m.id,
        amount: fromCents(cents),
        percentage: pct,
      };
    });
  }

  if (splitType === 'full_other') {
    const otherMembers = members.filter((m) => m.id !== payerMemberId);
    if (otherMembers.length === 0) {
      return [{ member_id: payerMemberId, amount: fromCents(totalCents), percentage: 100 }];
    }
    const count = otherMembers.length;
    const baseCents = Math.floor(totalCents / count);
    const remainderCents = totalCents - baseCents * count;

    return otherMembers.map((m, idx) => {
      const cents = idx < remainderCents ? baseCents + 1 : baseCents;
      const pct = Math.round((cents / totalCents) * 1000) / 10;
      return {
        member_id: m.id,
        amount: fromCents(cents),
        percentage: pct,
      };
    });
  }

  if (splitType === 'custom') {
    if (!customSplits || customSplits.length === 0) {
      return [{ member_id: payerMemberId, amount: fromCents(totalCents), percentage: 100 }];
    }

    const seenMembers = new Set<string>();
    const sanitized = customSplits.map((cs) => {
      if (!cs.member_id || !memberIds.has(cs.member_id)) {
        throw new Error('Todos os participantes do rateio devem pertencer aos membros do workspace.');
      }
      if (seenMembers.has(cs.member_id)) {
        throw new Error('Membros duplicados identificados no rateio customizado.');
      }
      seenMembers.add(cs.member_id);

      if (typeof cs.amount !== 'number' || !Number.isFinite(cs.amount) || cs.amount < 0) {
        throw new Error('O valor atribuído a cada membro no rateio não pode ser negativo.');
      }

      return {
        member_id: cs.member_id,
        cents: toCents(cs.amount),
      };
    });

    const sumCents = sanitized.reduce((acc, c) => acc + c.cents, 0);
    if (sumCents !== totalCents) {
      throw new Error(
        `A soma das divisões (R$ ${(sumCents / 100).toFixed(2)}) diverge do valor total da despesa (R$ ${(totalCents / 100).toFixed(2)}).`
      );
    }
    return sanitized.map((s) => ({
      member_id: s.member_id,
      amount: fromCents(s.cents),
      percentage: Math.round((s.cents / totalCents) * 1000) / 10,
    }));
  }

  return [{ member_id: payerMemberId, amount: fromCents(totalCents), percentage: 100 }];
}

/**
 * Calcula o balanço líquido de cada membro e consolida dívidas recíprocas (estilo Splitwise).
 */
export function calculateMemberNetBalances(
  transactions: Transaction[],
  settlements: Settlement[],
  members: WorkspaceMember[],
  workspaceId: string,
  purchases?: Purchase[]
): {
  balances: MemberNetBalance[];
  pairwiseDebts: PairwiseDebt[];
} {
  const wsMembers = members.filter((m) => m.workspace_id === workspaceId);

  const paidMap = new Map<string, number>();
  const shareMap = new Map<string, number>();
  const settledOutMap = new Map<string, number>();
  const settledInMap = new Map<string, number>();

  wsMembers.forEach((m) => {
    paidMap.set(m.id, 0);
    shareMap.set(m.id, 0);
    settledOutMap.set(m.id, 0);
    settledInMap.set(m.id, 0);
  });

  // 1. Despesas avulsas com rateio
  const wsTransactions = transactions.filter(
    (t) => t.workspace_id === workspaceId && t.status !== 'cancelled' && t.type === 'expense'
  );

  for (const tx of wsTransactions) {
    if (!tx.splits || tx.splits.length === 0) {
      continue;
    }

    const payerId = tx.paid_by_member_id || wsMembers[0]?.id;
    if (!payerId) continue;

    const txTotalCents = toCents(tx.amount);
    paidMap.set(payerId, (paidMap.get(payerId) || 0) + txTotalCents);

    for (const split of tx.splits) {
      if (split.member_id) {
        const splitCents = toCents(split.amount);
        shareMap.set(split.member_id, (shareMap.get(split.member_id) || 0) + splitCents);
      }
    }
  }

  // 2. Compras parceladas com rateio (P0-02: consolidada no total da compra uma única vez, sem duplicar por parcela)
  const wsPurchases = (purchases || []).filter(
    (p) => p.workspace_id === workspaceId && p.splits && p.splits.length > 0
  );

  for (const pur of wsPurchases) {
    const payerId = pur.paid_by_member_id || wsMembers[0]?.id;
    if (!payerId) continue;

    const purTotalCents = toCents(pur.total_amount);
    paidMap.set(payerId, (paidMap.get(payerId) || 0) + purTotalCents);

    for (const split of pur.splits || []) {
      if (split.member_id) {
        const splitCents = toCents(split.amount);
        shareMap.set(split.member_id, (shareMap.get(split.member_id) || 0) + splitCents);
      }
    }
  }

  // 3. Liquidações e acertos consolidados
  const wsSettlements = settlements.filter((s) => s.workspace_id === workspaceId);
  for (const s of wsSettlements) {
    const sCents = toCents(s.amount);
    settledOutMap.set(s.from_member_id, (settledOutMap.get(s.from_member_id) || 0) + sCents);
    settledInMap.set(s.to_member_id, (settledInMap.get(s.to_member_id) || 0) + sCents);
  }

  const balances: MemberNetBalance[] = wsMembers.map((m) => {
    const paid = paidMap.get(m.id) || 0;
    const share = shareMap.get(m.id) || 0;
    const settledOut = settledOutMap.get(m.id) || 0;
    const settledIn = settledInMap.get(m.id) || 0;

    const netCents = (paid - share) + (settledOut - settledIn);

    return {
      member_id: m.id,
      total_paid: fromCents(paid),
      total_share: fromCents(share),
      net_balance: fromCents(netCents),
    };
  });

  const creditors = balances
    .filter((b) => toCents(b.net_balance) > 0)
    .map((b) => ({ id: b.member_id, cents: toCents(b.net_balance) }))
    .sort((a, b) => b.cents - a.cents);

  const debtors = balances
    .filter((b) => toCents(b.net_balance) < 0)
    .map((b) => ({ id: b.member_id, cents: Math.abs(toCents(b.net_balance)) }))
    .sort((a, b) => b.cents - a.cents);

  const pairwiseDebts: PairwiseDebt[] = [];
  let cIdx = 0;
  let dIdx = 0;

  while (cIdx < creditors.length && dIdx < debtors.length) {
    const creditor = creditors[cIdx];
    const debtor = debtors[dIdx];

    const settleCents = Math.min(creditor.cents, debtor.cents);
    if (settleCents > 0) {
      pairwiseDebts.push({
        from_member_id: debtor.id,
        to_member_id: creditor.id,
        amount: fromCents(settleCents),
      });
      creditor.cents -= settleCents;
      debtor.cents -= settleCents;
    }

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
  pairwiseDebts?: PairwiseDebt[]
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
  const m1 = wsMembers.find((m) => m.id === fromMemberId);
  const m2 = wsMembers.find((m) => m.id === toMemberId);
  if (!m1 || !m2) {
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
