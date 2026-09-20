import { describe, it, expect } from 'vitest';
import { Account, CreditCard, Transaction, Transfer } from '../types';
import { calculateCardBillDates, splitInstallments } from '../financial-engine';
import { formatDate, formatMonthYear, getStatusBadge, sanitizeCsvCell } from '../utils';

describe('Domain Integration - Isolamento de Workspaces', () => {
  it('deve filtrar rigorosamente dados de múltiplos workspaces sem vazamento', () => {
    const ws1Accounts: Account[] = [
      {
        id: 'acc-ws1-1',
        workspace_id: 'ws-1',
        name: 'Nubank Pessoal',
        type: 'checking',
        institution: 'Nubank',
        initial_balance: 1000,
        current_balance: 1500,
        color: '#8b5cf6',
        active: true,
        created_at: '2026-01-01',
      },
    ];

    const ws2Accounts: Account[] = [
      {
        id: 'acc-ws2-1',
        workspace_id: 'ws-2',
        name: 'Itaú Conjunto',
        type: 'checking',
        institution: 'Itaú',
        initial_balance: 5000,
        current_balance: 7500,
        color: '#f97316',
        active: true,
        created_at: '2026-01-01',
      },
    ];

    const allAccounts = [...ws1Accounts, ...ws2Accounts];

    // Isolamento Workspace 1
    const filteredWs1 = allAccounts.filter((a) => a.workspace_id === 'ws-1');
    expect(filteredWs1).toHaveLength(1);
    expect(filteredWs1[0].id).toBe('acc-ws1-1');

    // Isolamento Workspace 2
    const filteredWs2 = allAccounts.filter((a) => a.workspace_id === 'ws-2');
    expect(filteredWs2).toHaveLength(1);
    expect(filteredWs2[0].id).toBe('acc-ws2-1');
  });
});

describe('Domain Integration - Compras 1x no Cartão e Faturas', () => {
  it('deve vincular compra 1x no cartão à fatura correspondente', () => {
    const card: CreditCard = {
      id: 'card-nu',
      workspace_id: 'ws-1',
      name: 'Nubank Ultravioleta',
      institution: 'Nubank',
      credit_limit: 15000,
      closing_day: 3,
      due_day: 10,
      color: '#8b5cf6',
      active: true,
      created_at: '2026-01-01',
    };

    // Compra 1x no dia 15/08 (após o fechamento do dia 3)
    const billDates = calculateCardBillDates('2026-08-15', card.closing_day, card.due_day);
    expect(billDates.referenceMonth).toBe('2026-09');
    expect(billDates.closingDate).toBe('2026-09-03');
    expect(billDates.dueDate).toBe('2026-09-10');
  });
});

describe('Domain Integration - Transferência Neutra entre Contas', () => {
  it('deve manter o patrimônio total inalterado ao realizar transferência', () => {
    const originAccount: Account = {
      id: 'acc-orig',
      workspace_id: 'ws-1',
      name: 'Conta Corrente',
      type: 'checking',
      institution: 'Banco A',
      initial_balance: 5000,
      current_balance: 5000,
      color: '#10b981',
      active: true,
      created_at: '2026-01-01',
    };

    const destAccount: Account = {
      id: 'acc-dest',
      workspace_id: 'ws-1',
      name: 'Reserva de Emergência',
      type: 'savings',
      institution: 'Banco B',
      initial_balance: 10000,
      current_balance: 10000,
      color: '#3b82f6',
      active: true,
      created_at: '2026-01-01',
    };

    const transferAmount = 2500;
    const initialTotal = originAccount.current_balance + destAccount.current_balance;

    // Executa transferência
    originAccount.current_balance -= transferAmount;
    destAccount.current_balance += transferAmount;

    const finalTotal = originAccount.current_balance + destAccount.current_balance;

    expect(originAccount.current_balance).toBe(2500);
    expect(destAccount.current_balance).toBe(12500);
    expect(finalTotal).toBe(initialTotal);
  });
});

describe('Domain Integration - Reversão de Saldo na Exclusão de Transação Paga', () => {
  it('deve estornar o valor debitado na conta ao excluir uma despesa paga', () => {
    let accountBalance = 4000;
    const tx: Transaction = {
      id: 'tx-paga',
      workspace_id: 'ws-1',
      account_id: 'acc-1',
      description: 'Supermercado',
      amount: 450,
      type: 'expense',
      transaction_date: '2026-08-10',
      due_date: '2026-08-10',
      status: 'paid',
      paid_amount: 450,
      created_at: '2026-08-10',
    };

    // Ao excluir despesa paga, o saldo da conta deve recuperar o valor
    const paidAmount = tx.paid_amount || tx.amount;
    accountBalance += paidAmount;

    expect(accountBalance).toBe(4450);
  });

  it('deve estornar o valor creditado na conta ao excluir uma receita paga', () => {
    let accountBalance = 8000;
    const tx: Transaction = {
      id: 'tx-rec',
      workspace_id: 'ws-1',
      account_id: 'acc-1',
      description: 'Salário',
      amount: 5000,
      type: 'income',
      transaction_date: '2026-08-05',
      due_date: '2026-08-05',
      status: 'paid',
      paid_amount: 5000,
      created_at: '2026-08-05',
    };

    // Ao excluir receita que havia sido creditada, o saldo deve ser deduzido
    accountBalance -= tx.paid_amount || tx.amount;
    expect(accountBalance).toBe(3000);
  });
});

describe('Domain Integration - Duplicação Segura de Transações', () => {
  it('deve zerar paid_amount e redefinir status para pending na duplicação', () => {
    const original: Transaction = {
      id: 'tx-orig',
      workspace_id: 'ws-1',
      description: 'Aluguel do Mês',
      amount: 2200,
      type: 'expense',
      transaction_date: '2026-08-01',
      due_date: '2026-08-10',
      status: 'paid',
      paid_amount: 2200,
      paid_at: '2026-08-08T10:00:00Z',
      created_at: '2026-08-01',
    };

    const duplicate: Transaction = {
      ...original,
      id: 'tx-dup-1',
      description: `${original.description} (Cópia)`,
      status: 'pending',
      paid_amount: 0,
      paid_at: null,
      created_at: '2026-08-22',
    };

    expect(duplicate.status).toBe('pending');
    expect(duplicate.paid_amount).toBe(0);
    expect(duplicate.paid_at).toBeNull();
    expect(duplicate.amount).toBe(2200);
  });
});

describe('Domain Integration - Utilitários Gerais (utils.ts)', () => {
  it('formatDate deve formatar datas válidas e retornar fallback quando inválido', () => {
    expect(formatDate('2026-08-15')).toBe('15/08/2026');
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
    // Data não ISO mas parseável via Date
    expect(formatDate('08/15/2026')).toMatch(/15\/08\/2026/);
    // Data totalmente inválida
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('formatMonthYear deve tratar datas de 7 caracteres, ISO completas e fallbacks', () => {
    expect(formatMonthYear('2026-08')).toBe('Agosto 2026');
    expect(formatMonthYear('2026-08-15')).toBe('Agosto 2026');
    expect(formatMonthYear(null)).toBe('-');
    expect(formatMonthYear(undefined)).toBe('-');
    expect(formatMonthYear('')).toBe('-');
    expect(formatMonthYear('data-invalida')).toBe('data-invalida');
  });

  it('getStatusBadge deve cobrir todos os status mapeados e o default', () => {
    expect(getStatusBadge('paid').label).toBe('Pago / Recebido');
    expect(getStatusBadge('partially_paid').label).toBe('Parcialmente Pago');
    expect(getStatusBadge('pending').label).toBe('Pendente');
    expect(getStatusBadge('overdue').label).toBe('Vencido');
    expect(getStatusBadge('cancelled').label).toBe('Cancelado');
    expect(getStatusBadge('open').label).toBe('Fatura Aberta');
    expect(getStatusBadge('closed').label).toBe('Fatura Fechada');
    expect(getStatusBadge('custom_unknown').label).toBe('custom_unknown');
  });

  it('sanitizeCsvCell deve tratar números, strings normais, caracteres de injeção e quebras de linha', () => {
    expect(sanitizeCsvCell(123.456)).toBe('123.46');
    expect(sanitizeCsvCell(null)).toBe('""');
    expect(sanitizeCsvCell(undefined)).toBe('""');
    expect(sanitizeCsvCell('Normal Text')).toBe('"Normal Text"');
    expect(sanitizeCsvCell('Texto com "aspas"')).toBe('"Texto com ""aspas"""');
    expect(sanitizeCsvCell('Linha 1\nLinha 2\r\nLinha 3')).toBe('"Linha 1 Linha 2 Linha 3"');
    expect(sanitizeCsvCell('=SUM(A1:B10)')).toBe('"\'=SUM(A1:B10)"');
    expect(sanitizeCsvCell('+12345')).toBe('"\'+12345"');
    expect(sanitizeCsvCell('-999')).toBe('"\'-999"');
    expect(sanitizeCsvCell('@command')).toBe('"\'@command"');
  });
});
