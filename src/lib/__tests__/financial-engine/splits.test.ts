import { describe, it, expect } from 'vitest';
import {
  calculateExpenseSplits,
  calculateMemberNetBalances,
  validateSettlement
} from '../../financial-engine';
import { Account, Category, CreditCard, CreditCardBill, Installment, Payment, Purchase, RecurringTransaction, Transaction, Settlement, WorkspaceMember } from '../../types';

describe('Financial Engine - Rateio de Despesas (calculateExpenseSplits)', () => {
  const members: WorkspaceMember[] = [
    { id: 'usr-1', workspace_id: 'ws-1', user_id: 'u1', role: 'owner', created_at: '2026-01-01' },
    { id: 'usr-2', workspace_id: 'ws-1', user_id: 'u2', role: 'member', created_at: '2026-01-01' },
    { id: 'usr-3', workspace_id: 'ws-1', user_id: 'u3', role: 'member', created_at: '2026-01-01' },
  ];

  it('deve calcular divisão individual onde 100% é responsabilidade do pagador', () => {
    const splits = calculateExpenseSplits(150, 'individual', members, 'usr-1');
    expect(splits).toHaveLength(1);
    expect(splits[0]).toEqual({
      member_id: 'usr-1',
      amount: 150,
      percentage: 100,
    });
  });

  it('deve calcular divisão igualitária (equal) com distribuição exata ao centavo e sem perda de resto', () => {
    // 100 / 3 = 33.34, 33.33, 33.33 -> soma exata 100.00
    const splits = calculateExpenseSplits(100, 'equal', members, 'usr-1');
    expect(splits).toHaveLength(3);
    const totalSplits = splits.reduce((acc, s) => acc + s.amount, 0);
    expect(totalSplits).toBe(100);
    expect(splits[0].amount).toBe(33.34);
    expect(splits[1].amount).toBe(33.33);
    expect(splits[2].amount).toBe(33.33);
  });

  it('deve calcular divisão 100% outro (full_other) onde o pagador tem 0 e outros membros dividem o total', () => {
    // 2 membros: P1 pagou para P2
    const twoMembers = members.slice(0, 2);
    const splits = calculateExpenseSplits(100, 'full_other', twoMembers, 'usr-1');
    expect(splits).toHaveLength(1);
    expect(splits[0]).toEqual({
      member_id: 'usr-2',
      amount: 100,
      percentage: 100,
    });
  });

  it('deve calcular divisão personalizada (custom) respeitando valores fixos informados', () => {
    const custom = [
      { member_id: 'usr-1', amount: 30 },
      { member_id: 'usr-2', amount: 70 },
    ];
    const splits = calculateExpenseSplits(100, 'custom', members.slice(0, 2), 'usr-1', custom);
    expect(splits).toHaveLength(2);
    expect(splits.find((s) => s.member_id === 'usr-1')?.amount).toBe(30);
    expect(splits.find((s) => s.member_id === 'usr-2')?.amount).toBe(70);
  });

  it('deve lançar erro se total for menor ou igual a zero ou lista de membros vazia', () => {
    expect(() => calculateExpenseSplits(0, 'equal', members, 'usr-1')).toThrow(
      'O valor total da despesa para rateio deve ser maior que zero.'
    );
    expect(() => calculateExpenseSplits(-50, 'equal', members, 'usr-1')).toThrow();
    expect(() => calculateExpenseSplits(100, 'equal', [], 'usr-1')).toThrow(
      'A lista de membros do workspace não pode estar vazia.'
    );
  });
});


describe('Financial Engine - Balanço Líquido e Acertos (calculateMemberNetBalances)', () => {
  const members: WorkspaceMember[] = [
    { id: 'm-p1', workspace_id: 'ws-1', user_id: 'u1', role: 'owner', created_at: '2026-01-01', user: { id: 'u1', name: 'Pessoa 1', email: 'p1@test.com', created_at: '2026-01-01' } },
    { id: 'm-p2', workspace_id: 'ws-1', user_id: 'u2', role: 'member', created_at: '2026-01-01', user: { id: 'u2', name: 'Pessoa 2', email: 'p2@test.com', created_at: '2026-01-01' } },
  ];

  it('deve resolver perfeitamente o cenário exato especificado pelo usuário', () => {
    // Cenário do Usuário:
    // - Agua: Pessoa 1 paga 300 (dividida 50/50: 150 P1, 150 P2).
    // - Luz: Pessoa 1 paga 200 (dividida 50/50: 100 P1, 100 P2).
    // - Roupa: Pessoa 1 compra no cartão da Pessoa 2 por 100 (100% P1: 100 P1, 0 P2, paga por P2 no cartão).
    // - Item 1: Pessoa 1 compra no cartão da Pessoa 2 por 200 (dividida 50/50: 100 P1, 100 P2, paga por P2 no cartão).
    // - Item 2: Pessoa 2 compra no cartão da Pessoa 2 por 100 (sem divisão, 100% P2: 0 P1, 100 P2, paga por P2 no cartão).
    //
    // Resultado Esperado:
    // Pessoa 1 deve à Pessoa 2: 100 (Roupa) + 100 (Item 1) = 200.
    // Pessoa 2 deve à Pessoa 1: 150 (Agua) + 100 (Luz) = 250.
    // Saldo Final Consolidado: Pessoa 2 deve R$ 50 para a Pessoa 1!
    const transactions: Transaction[] = [
      {
        id: 'tx-agua',
        workspace_id: 'ws-1',
        description: 'Água',
        amount: 300,
        type: 'expense',
        status: 'paid',
        transaction_date: '2026-09-01',
        due_date: '2026-09-01',
        paid_by_member_id: 'm-p1',
        split_type: 'equal',
        splits: [
          { member_id: 'm-p1', amount: 150, percentage: 50 },
          { member_id: 'm-p2', amount: 150, percentage: 50 },
        ],
        created_at: '2026-09-01T10:00:00Z',
      },
      {
        id: 'tx-luz',
        workspace_id: 'ws-1',
        description: 'Luz',
        amount: 200,
        type: 'expense',
        status: 'paid',
        transaction_date: '2026-09-02',
        due_date: '2026-09-02',
        paid_by_member_id: 'm-p1',
        split_type: 'equal',
        splits: [
          { member_id: 'm-p1', amount: 100, percentage: 50 },
          { member_id: 'm-p2', amount: 100, percentage: 50 },
        ],
        created_at: '2026-09-02T10:00:00Z',
      },
      {
        id: 'tx-roupa',
        workspace_id: 'ws-1',
        description: 'Roupa',
        amount: 100,
        type: 'expense',
        status: 'pending',
        credit_card_id: 'card-p2',
        transaction_date: '2026-09-03',
        due_date: '2026-09-10',
        paid_by_member_id: 'm-p2', // Cartão da Pessoa 2 é pago pela Pessoa 2
        split_type: 'full_other',
        splits: [
          { member_id: 'm-p1', amount: 100, percentage: 100 },
        ],
        created_at: '2026-09-03T10:00:00Z',
      },
      {
        id: 'tx-item1',
        workspace_id: 'ws-1',
        description: 'Item 1',
        amount: 200,
        type: 'expense',
        status: 'pending',
        credit_card_id: 'card-p2',
        transaction_date: '2026-09-04',
        due_date: '2026-09-10',
        paid_by_member_id: 'm-p2',
        split_type: 'equal',
        splits: [
          { member_id: 'm-p1', amount: 100, percentage: 50 },
          { member_id: 'm-p2', amount: 100, percentage: 50 },
        ],
        created_at: '2026-09-04T10:00:00Z',
      },
      {
        id: 'tx-item2',
        workspace_id: 'ws-1',
        description: 'Item 2',
        amount: 100,
        type: 'expense',
        status: 'pending',
        credit_card_id: 'card-p2',
        transaction_date: '2026-09-05',
        due_date: '2026-09-10',
        paid_by_member_id: 'm-p2',
        split_type: 'individual',
        splits: [
          { member_id: 'm-p2', amount: 100, percentage: 100 },
        ],
        created_at: '2026-09-05T10:00:00Z',
      },
    ];

    const { balances, pairwiseDebts } = calculateMemberNetBalances(transactions, [], members, 'ws-1');

    // Balanço de P1: pagou 500, deve 450 -> saldo líquido +50 (a receber)
    const bP1 = balances.find((b) => b.member_id === 'm-p1')!;
    expect(bP1.total_paid).toBe(500);
    expect(bP1.total_share).toBe(450);
    expect(bP1.net_balance).toBe(50);

    // Balanço de P2: pagou 400, deve 450 -> saldo líquido -50 (a pagar)
    const bP2 = balances.find((b) => b.member_id === 'm-p2')!;
    expect(bP2.total_paid).toBe(400);
    expect(bP2.total_share).toBe(450);
    expect(bP2.net_balance).toBe(-50);

    // Dívidas consolidadas: P2 deve 50 para P1!
    expect(pairwiseDebts).toHaveLength(1);
    expect(pairwiseDebts[0]).toEqual({
      from_member_id: 'm-p2',
      to_member_id: 'm-p1',
      amount: 50,
    });
  });

  it('deve zerar as pendências após o registro do acerto de contas (Settlement)', () => {
    const transactions: Transaction[] = [
      {
        id: 'tx-1',
        workspace_id: 'ws-1',
        description: 'Jantar',
        amount: 100,
        type: 'expense',
        status: 'paid',
        transaction_date: '2026-09-01',
        due_date: '2026-09-01',
        paid_by_member_id: 'm-p1',
        split_type: 'equal',
        splits: [
          { member_id: 'm-p1', amount: 50, percentage: 50 },
          { member_id: 'm-p2', amount: 50, percentage: 50 },
        ],
        created_at: '2026-09-01T10:00:00Z',
      },
    ];

    const settlements: Settlement[] = [
      {
        id: 'set-1',
        workspace_id: 'ws-1',
        from_member_id: 'm-p2',
        to_member_id: 'm-p1',
        amount: 50,
        settlement_date: '2026-09-02',
        created_at: '2026-09-02T10:00:00Z',
      },
    ];

    const { balances, pairwiseDebts } = calculateMemberNetBalances(transactions, settlements, members, 'ws-1');

    expect(balances.find((b) => b.member_id === 'm-p1')?.net_balance).toBe(0);
    expect(balances.find((b) => b.member_id === 'm-p2')?.net_balance).toBe(0);
    expect(pairwiseDebts).toHaveLength(0);
  });

  it('deve simplificar dívidas transitivas entre 3 pessoas (A deve B, B deve C -> A deve C)', () => {
    const threeMembers: WorkspaceMember[] = [
      { id: 'm-a', workspace_id: 'ws-1', user_id: 'ua', role: 'owner', created_at: '2026-01-01' },
      { id: 'm-b', workspace_id: 'ws-1', user_id: 'ub', role: 'member', created_at: '2026-01-01' },
      { id: 'm-c', workspace_id: 'ws-1', user_id: 'uc', role: 'member', created_at: '2026-01-01' },
    ];

    // B pagou 100 para A (A deve 100 a B)
    // C pagou 100 para B (B deve 100 a C)
    // No final: B tem net_balance 0 (+100 - 100), A deve 100, C recebe 100.
    // O motor deve simplificar para 1 única transferência: A deve 100 a C!
    const txs: Transaction[] = [
      {
        id: 'tx-1',
        workspace_id: 'ws-1',
        description: 'B pagou para A',
        amount: 100,
        type: 'expense',
        status: 'paid',
        transaction_date: '2026-09-01',
        due_date: '2026-09-01',
        paid_by_member_id: 'm-b',
        split_type: 'full_other',
        splits: [{ member_id: 'm-a', amount: 100, percentage: 100 }],
        created_at: '2026-09-01T10:00:00Z',
      },
      {
        id: 'tx-2',
        workspace_id: 'ws-1',
        description: 'C pagou para B',
        amount: 100,
        type: 'expense',
        status: 'paid',
        transaction_date: '2026-09-02',
        due_date: '2026-09-02',
        paid_by_member_id: 'm-c',
        split_type: 'full_other',
        splits: [{ member_id: 'm-b', amount: 100, percentage: 100 }],
        created_at: '2026-09-02T10:00:00Z',
      },
    ];

    const { balances, pairwiseDebts } = calculateMemberNetBalances(txs, [], threeMembers, 'ws-1');

    expect(balances.find((b) => b.member_id === 'm-b')?.net_balance).toBe(0);
    expect(balances.find((b) => b.member_id === 'm-a')?.net_balance).toBe(-100);
    expect(balances.find((b) => b.member_id === 'm-c')?.net_balance).toBe(100);

    expect(pairwiseDebts).toHaveLength(1);
    expect(pairwiseDebts[0]).toEqual({
      from_member_id: 'm-a',
      to_member_id: 'm-c',
      amount: 100,
    });
  });

  it('deve respeitar estritamente o isolamento de workspace', () => {
    const txOtherWs: Transaction[] = [
      {
        id: 'tx-other',
        workspace_id: 'ws-other',
        description: 'Gasto Outro Workspace',
        amount: 500,
        type: 'expense',
        status: 'paid',
        transaction_date: '2026-09-01',
        due_date: '2026-09-01',
        paid_by_member_id: 'm-p1',
        split_type: 'equal',
        splits: [{ member_id: 'm-p2', amount: 500 }],
        created_at: '2026-09-01T10:00:00Z',
      },
    ];

    const { balances, pairwiseDebts } = calculateMemberNetBalances(txOtherWs, [], members, 'ws-1');
    expect(balances.every((b) => b.net_balance === 0)).toBe(true);
    expect(pairwiseDebts).toHaveLength(0);
  });

  it('deve ordenar e simplificar corretamente com múltiplos credores e devedores, ignorando transações sem splits', () => {
    const fourMembers: WorkspaceMember[] = [
      { id: 'm-1', workspace_id: 'ws-1', user_id: 'u1', role: 'owner', created_at: '2026-01-01' },
      { id: 'm-2', workspace_id: 'ws-1', user_id: 'u2', role: 'member', created_at: '2026-01-01' },
      { id: 'm-3', workspace_id: 'ws-1', user_id: 'u3', role: 'member', created_at: '2026-01-01' },
      { id: 'm-4', workspace_id: 'ws-1', user_id: 'u4', role: 'member', created_at: '2026-01-01' },
    ];

    // Transações:
    // txSemSplits: sem splits ou splits vazio -> deve ser ignorada na partilha
    // tx1: M1 pagou 200, dividido 100 para M3 e 100 para M4 (M1 credor +200, M3 -100, M4 -100)
    // tx2: M2 pagou 50, dividido 50 para M3 (M2 credor +50, M3 -150 no total, M4 -100 no total)
    // Assim temos 2 credores: M1 (+200), M2 (+50) -> testará a ordenação decrescente de credores
    // E temos 2 devedores: M3 (-150), M4 (-100) -> testará a ordenação decrescente de devedores
    const txs: Transaction[] = [
      {
        id: 'tx-no-splits-1',
        workspace_id: 'ws-1',
        description: 'Sem splits',
        amount: 30,
        type: 'expense',
        status: 'paid',
        transaction_date: '2026-09-01',
        due_date: '2026-09-01',
        created_at: '2026-09-01T10:00:00Z',
      },
      {
        id: 'tx-empty-splits',
        workspace_id: 'ws-1',
        description: 'Splits vazio',
        amount: 30,
        type: 'expense',
        status: 'paid',
        transaction_date: '2026-09-01',
        due_date: '2026-09-01',
        splits: [],
        created_at: '2026-09-01T10:00:00Z',
      },
      {
        id: 'tx-1',
        workspace_id: 'ws-1',
        description: 'M1 pagou despesa para M3 e M4',
        amount: 200,
        type: 'expense',
        status: 'paid',
        transaction_date: '2026-09-01',
        due_date: '2026-09-01',
        paid_by_member_id: 'm-1',
        split_type: 'equal',
        splits: [
          { member_id: 'm-3', amount: 100 },
          { member_id: 'm-4', amount: 100 },
        ],
        created_at: '2026-09-01T10:00:00Z',
      },
      {
        id: 'tx-2',
        workspace_id: 'ws-1',
        description: 'M2 pagou despesa para M3',
        amount: 50,
        type: 'expense',
        status: 'paid',
        transaction_date: '2026-09-01',
        due_date: '2026-09-01',
        paid_by_member_id: 'm-2',
        split_type: 'full_other',
        splits: [{ member_id: 'm-3', amount: 50 }],
        created_at: '2026-09-01T10:00:00Z',
      },
    ];

    const { balances, pairwiseDebts } = calculateMemberNetBalances(txs, [], fourMembers, 'ws-1');

    expect(balances.find((b) => b.member_id === 'm-1')?.net_balance).toBe(200);
    expect(balances.find((b) => b.member_id === 'm-2')?.net_balance).toBe(50);
    expect(balances.find((b) => b.member_id === 'm-3')?.net_balance).toBe(-150);
    expect(balances.find((b) => b.member_id === 'm-4')?.net_balance).toBe(-100);

    // Dívidas liquidadas gulosamente:
    // Maior credor M1 (+200) com maior devedor M3 (-150): M3 paga 150 para M1 (M1 resta 50, M3 zerado)
    // Maior credor M1 (+50) com próximo devedor M4 (-100): M4 paga 50 para M1 (M1 zerado, M4 resta 50)
    // Próximo credor M2 (+50) com devedor restante M4 (-50): M4 paga 50 para M2 (M2 zerado, M4 zerado)
    expect(pairwiseDebts).toEqual([
      { from_member_id: 'm-3', to_member_id: 'm-1', amount: 150 },
      { from_member_id: 'm-4', to_member_id: 'm-1', amount: 50 },
      { from_member_id: 'm-4', to_member_id: 'm-2', amount: 50 },
    ]);
  });
});


describe('Financial Engine - Validação de Acertos (validateSettlement)', () => {
  const members: WorkspaceMember[] = [
    { id: 'm-1', workspace_id: 'ws-1', user_id: 'u1', role: 'owner', created_at: '2026-01-01' },
    { id: 'm-2', workspace_id: 'ws-1', user_id: 'u2', role: 'member', created_at: '2026-01-01' },
  ];

  it('deve aprovar liquidação válida entre dois membros existentes', () => {
    expect(() => validateSettlement('m-1', 'm-2', 50, members, 'ws-1')).not.toThrow();
  });

  it('deve rejeitar acerto consigo mesmo', () => {
    expect(() => validateSettlement('m-1', 'm-1', 50, members, 'ws-1')).toThrow(
      'O membro pagador e o recebedor do acerto não podem ser a mesma pessoa.'
    );
  });

  it('deve rejeitar membros não preenchidos ou vazios', () => {
    expect(() => validateSettlement('', 'm-2', 50, members, 'ws-1')).toThrow(
      'Membros devedor e credor devem ser informados para o acerto.'
    );
  });

  it('deve rejeitar valores nulos, negativos, zero ou não finitos', () => {
    expect(() => validateSettlement('m-1', 'm-2', 0, members, 'ws-1')).toThrow(
      'O valor do acerto deve ser maior que zero.'
    );
    expect(() => validateSettlement('m-1', 'm-2', -10, members, 'ws-1')).toThrow();
    expect(() => validateSettlement('m-1', 'm-2', NaN, members, 'ws-1')).toThrow();
  });

  it('deve rejeitar membros que não pertençam ao workspace ativo', () => {
    expect(() => validateSettlement('m-1', 'm-inexistente', 50, members, 'ws-1')).toThrow(
      'Os membros participantes do acerto devem pertencer ao workspace ativo.'
    );
  });

  it('deve validar limites contra pairwiseDebts (P0-01 Local)', () => {
    const pairwiseDebts = [
      { from_member_id: 'm-2', to_member_id: 'm-1', amount: 50.0 },
    ];

    // Sem dívida de m-1 para m-2: deve rejeitar
    expect(() => validateSettlement('m-1', 'm-2', 10, members, 'ws-1', pairwiseDebts)).toThrow(
      'Não há débito pendente registrado entre o pagador e o recebedor informados.'
    );

    // Dívida de m-2 para m-1 existe: valor superior deve rejeitar
    expect(() => validateSettlement('m-2', 'm-1', 50.01, members, 'ws-1', pairwiseDebts)).toThrow(
      /O valor do acerto \(R\$\s*50\.01\) excede a dívida pendente de R\$\s*50\.00/
    );

    // Valor exato deve ser aprovado
    expect(() => validateSettlement('m-2', 'm-1', 50.0, members, 'ws-1', pairwiseDebts)).not.toThrow();

    // Valor parcial deve ser aprovado
    expect(() => validateSettlement('m-2', 'm-1', 20.0, members, 'ws-1', pairwiseDebts)).not.toThrow();
  });
});


describe('Financial Engine - Divisão de Despesas (calculateExpenseSplits)', () => {
  const members: WorkspaceMember[] = [
    { id: 'm-1', workspace_id: 'ws-1', user_id: 'u-1', role: 'owner', created_at: '2026-01-01' },
    { id: 'm-2', workspace_id: 'ws-1', user_id: 'u-2', role: 'member', created_at: '2026-01-01' },
    { id: 'm-3', workspace_id: 'ws-1', user_id: 'u-3', role: 'member', created_at: '2026-01-01' },
  ];

  it('deve calcular divisão igual (equal) somando 100% dos centavos mesmo com dízima', () => {
    const splits = calculateExpenseSplits(100, 'equal', members, 'm-1');
    expect(splits).toHaveLength(3);
    const total = splits.reduce((acc, s) => acc + s.amount, 0);
    expect(total).toBe(100);
    // 33.34, 33.33, 33.33
    expect(splits.map((s) => s.amount).sort()).toEqual([33.33, 33.33, 33.34]);
  });

  it('deve calcular full_other para 2 membros atribuindo 100% ao outro', () => {
    const twoMembers = members.slice(0, 2);
    const splits = calculateExpenseSplits(150, 'full_other', twoMembers, 'm-1');
    expect(splits).toEqual([{ member_id: 'm-2', amount: 150, percentage: 100 }]);
  });

  it('deve calcular full_other para 3+ membros dividindo igualmente entre os outros membros (P0-03 Local)', () => {
    const splits = calculateExpenseSplits(100, 'full_other', members, 'm-1');
    expect(splits).toHaveLength(2);
    expect(splits.some((s) => s.member_id === 'm-1')).toBe(false);
    expect(splits.map((s) => s.member_id).sort()).toEqual(['m-2', 'm-3']);
    const total = splits.reduce((acc, s) => acc + s.amount, 0);
    expect(total).toBe(100);
    expect(splits.every((s) => s.amount === 50)).toBe(true);
  });

  it('deve aceitar custom splits válidos somando o total exato', () => {
    const custom = [
      { member_id: 'm-1', amount: 30 },
      { member_id: 'm-2', amount: 70 },
    ];
    const splits = calculateExpenseSplits(100, 'custom', members, 'm-1', custom);
    expect(splits).toEqual([
      { member_id: 'm-1', amount: 30, percentage: 30 },
      { member_id: 'm-2', amount: 70, percentage: 70 },
    ]);
  });

  it('deve rejeitar custom splits com valores negativos (P0-03 Local)', () => {
    const custom = [
      { member_id: 'm-1', amount: -20 },
      { member_id: 'm-2', amount: 120 },
    ];
    expect(() => calculateExpenseSplits(100, 'custom', members, 'm-1', custom)).toThrow(
      'O valor atribuído a cada membro no rateio não pode ser negativo.'
    );
  });

  it('deve rejeitar custom splits com membros duplicados (P1-01 Local)', () => {
    const custom = [
      { member_id: 'm-1', amount: 50 },
      { member_id: 'm-1', amount: 50 },
    ];
    expect(() => calculateExpenseSplits(100, 'custom', members, 'm-1', custom)).toThrow(
      'Membros duplicados identificados no rateio customizado.'
    );
  });

  it('deve rejeitar custom splits com membros fora do workspace (P1-01 Local)', () => {
    const custom = [
      { member_id: 'm-inexistente', amount: 100 },
    ];
    expect(() => calculateExpenseSplits(100, 'custom', members, 'm-1', custom)).toThrow(
      'Todos os participantes do rateio devem pertencer aos membros do workspace.'
    );
  });

  it('deve rejeitar pagador que não pertença ao workspace ativo (P1-01 Local)', () => {
    expect(() => calculateExpenseSplits(100, 'equal', members, 'm-outro')).toThrow(
      'O membro pagador deve pertencer à lista de membros do workspace.'
    );
  });

  it('deve rejeitar quando soma do custom diverge do total da despesa', () => {
    const custom = [
      { member_id: 'm-1', amount: 40 },
      { member_id: 'm-2', amount: 40 },
    ];
    expect(() => calculateExpenseSplits(100, 'custom', members, 'm-1', custom)).toThrow(
      /A soma das divisões/
    );
  });
});


describe('Financial Engine - Balanços com Compras Parceladas (calculateMemberNetBalances Purchases P0-02)', () => {
  const members: WorkspaceMember[] = [
    { id: 'm-1', workspace_id: 'ws-1', user_id: 'u-1', role: 'owner', created_at: '2026-01-01' },
    { id: 'm-2', workspace_id: 'ws-1', user_id: 'u-2', role: 'member', created_at: '2026-01-01' },
  ];

  it('deve consolidar compra parcelada com rateio uma única vez sem duplicar (P0-02 Local)', () => {
    const purchases: Purchase[] = [
      {
        id: 'pur-1',
        workspace_id: 'ws-1',
        description: 'Geladeira Nova 10x',
        total_amount: 3000,
        installment_count: 10,
        paid_by_member_id: 'm-1',
        split_type: 'equal',
        splits: [
          { member_id: 'm-1', amount: 1500 },
          { member_id: 'm-2', amount: 1500 },
        ],
        purchase_date: '2026-09-01',
        created_at: '2026-09-01T10:00:00Z',
      },
    ];

    const { balances, pairwiseDebts } = calculateMemberNetBalances([], [], members, 'ws-1', purchases);

    const b1 = balances.find((b) => b.member_id === 'm-1');
    const b2 = balances.find((b) => b.member_id === 'm-2');

    expect(b1?.total_paid).toBe(3000);
    expect(b1?.total_share).toBe(1500);
    expect(b1?.net_balance).toBe(1500);

    expect(b2?.total_paid).toBe(0);
    expect(b2?.total_share).toBe(1500);
    expect(b2?.net_balance).toBe(-1500);

    expect(pairwiseDebts).toEqual([
      { from_member_id: 'm-2', to_member_id: 'm-1', amount: 1500 },
    ]);
  });
});

