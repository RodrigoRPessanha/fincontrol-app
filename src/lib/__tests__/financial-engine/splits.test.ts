import { describe, it, expect } from 'vitest';
import {
  calculateExpenseSplits,
  calculateMemberNetBalances,
  validateSettlement,
  PairwiseDebt,
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

    const splits3 = calculateExpenseSplits(100.01, 'full_other', members, 'usr-1');
    expect(splits3).toHaveLength(2);
    expect(splits3[0].amount).toBe(50.01);
    expect(splits3[1].amount).toBe(50.00);
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

  it('deve consolidar compras parceladas com rateio no balanço líquido dos membros', () => {
    const pur: Purchase = {
      id: 'pur-1',
      workspace_id: 'ws-1',
      description: 'Notebook parcelado',
      total_amount: 100,
      installment_count: 2,
      purchase_date: '2026-09-01',
      paid_by_member_id: 'm-p1',
      split_type: 'equal',
      splits: [
        { member_id: 'm-p1', amount: 50, percentage: 50 },
        { member_id: 'm-p2', amount: 50, percentage: 50 },
      ],
      created_at: '2026-09-01T10:00:00Z',
    };
    const resWithPur = calculateMemberNetBalances([], [], members, 'ws-1', [pur]);
    expect(resWithPur.balances.find((b) => b.member_id === 'm-p1')?.net_balance).toBe(50);
    expect(resWithPur.balances.find((b) => b.member_id === 'm-p2')?.net_balance).toBe(-50);
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

  it('calcula balanços quando compras e liquidações envolvem pessoas sem cadastro prévio', () => {
    const members: WorkspaceMember[] = [
      { id: 'm-1', workspace_id: 'ws-1', user_id: 'u1', role: 'owner', created_at: '2026-01-01' },
    ];

    const purchases: Purchase[] = [
      {
        id: 'pur-person',
        workspace_id: 'ws-1',
        description: 'Móveis pagos por pessoa',
        total_amount: 1000,
        installment_count: 5,
        paid_by_person_id: 'p-payer',
        split_type: 'equal',
        splits: [
          { person_id: 'p-payer', amount: 500 },
          { person_id: 'p-friend', amount: 500 },
        ],
        purchase_date: '2026-09-01',
        created_at: '2026-09-01T10:00:00Z',
      },
    ];

    const settlements: Settlement[] = [
      {
        id: 'set-person',
        workspace_id: 'ws-1',
        from_person_id: 'p-friend',
        to_person_id: 'p-payer',
        amount: 200,
        settlement_date: '2026-09-05',
        created_at: '2026-09-05T10:00:00Z',
      },
    ];

    const { balances, pairwiseDebts } = calculateMemberNetBalances([], settlements, members, 'ws-1', purchases);

    const bPayer = balances.find((b) => b.participant_id === 'p-payer');
    const bFriend = balances.find((b) => b.participant_id === 'p-friend');

    expect(bPayer?.net_balance).toBe(300); // 500 - 200 settled
    expect(bFriend?.net_balance).toBe(-300); // -500 + 200 settled

    expect(pairwiseDebts).toEqual([
      { from_member_id: 'p-friend', to_member_id: 'p-payer', amount: 300 },
    ]);
  });

  it('deve registrar participantes externos como Pessoa externa quando ausentes da lista de pessoas', () => {
    const transactions = [
      {
        id: 'tx-ext',
        workspace_id: 'ws-1',
        description: 'Jantar com desconhecidos',
        amount: 100,
        transaction_date: '2026-09-01',
        paid_by_person_id: 'p-desconhecido-1',
        type: 'expense' as const,
        status: 'paid' as const,
        split_type: 'equal' as const,
        splits: [
          { person_id: 'p-desconhecido-1', amount: 50 },
          { person_id: 'p-desconhecido-2', amount: 50 },
        ],
        due_date: '2026-09-01',
        created_at: '2026-09-01T10:00:00Z',
      },
    ];

    const settlements: Settlement[] = [
      {
        id: 'set-ext',
        workspace_id: 'ws-1',
        from_person_id: 'p-desconhecido-3',
        to_person_id: 'p-desconhecido-4',
        amount: 20,
        settlement_date: '2026-09-02',
        created_at: '2026-09-02T10:00:00Z',
      },
    ];

    const { balances } = calculateMemberNetBalances(transactions, settlements, members, 'ws-1', [], []);

    expect(balances.some((b) => b.participant_id === 'p-desconhecido-1' && b.name === 'Pessoa externa')).toBe(true);
    expect(balances.some((b) => b.participant_id === 'p-desconhecido-2' && b.name === 'Pessoa externa')).toBe(true);
    expect(balances.some((b) => b.participant_id === 'p-desconhecido-3' && b.name === 'Pessoa externa')).toBe(true);
    expect(balances.some((b) => b.participant_id === 'p-desconhecido-4' && b.name === 'Pessoa externa')).toBe(true);
  });

  it('deve calcular divisão individual e validar acerto com dívidas consolidadas', () => {
    const single = calculateExpenseSplits(100, 'individual', [{ id: 'm-1', name: 'Rodrigo', type: 'member' }], 'm-1');
    expect(single.length).toBe(1);
    expect(single[0].amount).toBe(100);

    const pairwise: PairwiseDebt[] = [
      { from_member_id: 'm-2', to_member_id: 'm-1', amount: 50 },
    ];
    Object.defineProperties(pairwise[0], {
      from_id: { value: 'm-2' },
      to_id: { value: 'm-1' },
    });

    expect(() => validateSettlement('m-2', 'm-1', 50, members, 'ws-1', pairwise)).not.toThrow();
    expect(() => validateSettlement('m-2', 'm-1', 60, members, 'ws-1', pairwise)).toThrow(
      /excede a dívida pendente/
    );
  });

  it('deve lidar com compras parceladas sem pagador identificado ou com splits vazios ou sem ID', () => {
    const purchaseWithoutSplits: Purchase = {
      id: 'pur-empty',
      workspace_id: 'ws-1',
      description: 'Compra sem splits',
      total_amount: 100,
      installment_count: 2,
      purchase_date: '2026-09-01',
      paid_by_member_id: 'usr-1',
      splits: undefined,
      created_at: '2026-09-01',
    };

    const txWithoutPayer: Transaction = {
      id: 'tx-no-payer',
      workspace_id: 'ws-empty',
      description: 'Tx sem pagador',
      amount: 50,
      type: 'expense',
      status: 'pending',
      transaction_date: '2026-09-01',
      due_date: '2026-09-01',
      splits: [{ person_id: 'p-1', amount: 50 }],
      created_at: '2026-09-01',
    };

    const purchaseWithoutPayer: Purchase = {
      id: 'pur-no-payer',
      workspace_id: 'ws-empty',
      description: 'Compra sem pagador',
      total_amount: 50,
      installment_count: 1,
      purchase_date: '2026-09-01',
      paid_by_member_id: undefined,
      paid_by_person_id: undefined,
      splits: [{ person_id: 'p-1', amount: 50 }],
      created_at: '2026-09-01',
    };

    const purchaseWithInvalidSplit: Purchase = {
      id: 'pur-invalid-split',
      workspace_id: 'ws-1',
      description: 'Compra split inválido',
      total_amount: 80,
      installment_count: 1,
      purchase_date: '2026-09-01',
      paid_by_member_id: 'usr-1',
      splits: [
        { amount: 40 } as any,
        { member_id: 'usr-2', amount: 40 },
      ],
      created_at: '2026-09-01',
    };

    const res1 = calculateMemberNetBalances([txWithoutPayer], [], [], 'ws-empty', [purchaseWithoutPayer], []);
    expect(res1.balances.length).toBeGreaterThan(0);

    const res2 = calculateMemberNetBalances([], [], members, 'ws-1', [purchaseWithoutSplits, purchaseWithInvalidSplit], []);
    expect(res2.balances.length).toBeGreaterThan(0);
  });

  it('deve exercitar cs.person_id e participantMap em custom splits e nova pessoa em compra', () => {
    const splitsCustom = calculateExpenseSplits(
      100,
      'custom',
      [
        { id: 'p-1', name: 'Carlos', type: 'person' },
        { id: 'm-1', name: 'Rodrigo', type: 'member' },
      ],
      'm-1',
      [
        { person_id: 'p-1', amount: 40 },
        { member_id: 'm-1', amount: 60 },
      ]
    );
    expect(splitsCustom).toHaveLength(2);
    expect(splitsCustom[0].person_id).toBe('p-1');
    expect(splitsCustom[1].member_id).toBe('m-1');

    const purWithNewPerson: Purchase = {
      id: 'pur-new-person',
      workspace_id: 'ws-1',
      description: 'Compra com nova pessoa',
      total_amount: 100,
      installment_count: 2,
      purchase_date: '2026-09-01',
      paid_by_member_id: 'usr-1',
      splits: [{ person_id: 'p-brand-new', amount: 100 }],
      created_at: '2026-09-01',
    };
    const resNew = calculateMemberNetBalances([], [], members, 'ws-1', [purWithNewPerson], []);
    expect(resNew.balances.some((b) => b.participant_id === 'p-brand-new')).toBe(true);
  });

  it('deve cobrir cs.id em custom splits e compra com splits indefinidos em calculateMemberNetBalances', () => {
    const splitsViaId = calculateExpenseSplits(
      100,
      'custom',
      [
        { id: 'm-1', name: 'Rodrigo', type: 'member' },
        { id: 'm-2', name: 'Ana', type: 'member' },
      ],
      'm-1',
      [
        { id: 'm-1', amount: 50 },
        { id: 'm-2', amount: 50 },
      ] as any
    );
    expect(splitsViaId).toHaveLength(2);
    expect(splitsViaId[0].member_id).toBe('m-1');
    expect(splitsViaId[1].member_id).toBe('m-2');

    const purWithoutSplits: Purchase = {
      id: 'pur-no-splits',
      workspace_id: 'ws-1',
      description: 'Compra sem splits',
      total_amount: 100,
      installment_count: 1,
      purchase_date: '2026-09-01',
      paid_by_member_id: 'usr-1',
      splits: undefined,
      created_at: '2026-09-01',
    };
    const res = calculateMemberNetBalances([], [], members, 'ws-1', [purWithoutSplits], []);
    expect(res.balances.length).toBeGreaterThan(0);
  });

  it('deve cobrir getType com is_member: false, person_id e payerMemberId como objeto sem type', () => {
    const rawParticipants = [
      { id: 'p-legacy-1', is_member: false },
      { id: 'p-legacy-2', person_id: 'p-legacy-2' },
      { id: 'm-legacy-3' },
    ];
    const splits = calculateExpenseSplits(
      90,
      'equal',
      rawParticipants as any,
      { id: 'p-legacy-1' } as any
    );
    expect(splits).toHaveLength(3);
    expect(splits[0].person_id).toBe('p-legacy-1');
    expect(splits[1].person_id).toBe('p-legacy-2');
    expect(splits[2].member_id).toBe('m-legacy-3');
  });

  it('deve desempatar credores e devedores com mesmo saldo de forma determinística por ID', () => {
    const customMembers: WorkspaceMember[] = [
      { id: 'cred-b', workspace_id: 'ws-1', user_id: 'u-cb', role: 'member', created_at: '2026-01-01' },
      { id: 'cred-a', workspace_id: 'ws-1', user_id: 'u-ca', role: 'member', created_at: '2026-01-01' },
      { id: 'deb-b', workspace_id: 'ws-1', user_id: 'u-db', role: 'member', created_at: '2026-01-01' },
      { id: 'deb-a', workspace_id: 'ws-1', user_id: 'u-da', role: 'member', created_at: '2026-01-01' },
    ];

    // Transações onde cred-b e cred-a pagam 100 cada para deb-b e deb-a
    const txs: Transaction[] = [
      {
        id: 'tx-1',
        workspace_id: 'ws-1',
        description: 'Cred B paga para Deb B',
        amount: 100,
        type: 'expense',
        status: 'paid',
        due_date: '2026-09-01',
        transaction_date: '2026-09-01',
        paid_by_member_id: 'cred-b',
        split_type: 'custom',
        splits: [
          { member_id: 'deb-b', amount: 100, percentage: 100 },
        ],
        created_at: '2026-09-01',
      },
      {
        id: 'tx-2',
        workspace_id: 'ws-1',
        description: 'Cred A paga para Deb A',
        amount: 100,
        type: 'expense',
        status: 'paid',
        due_date: '2026-09-01',
        transaction_date: '2026-09-01',
        paid_by_member_id: 'cred-a',
        split_type: 'custom',
        splits: [
          { member_id: 'deb-a', amount: 100, percentage: 100 },
        ],
        created_at: '2026-09-01',
      },
    ];

    const result = calculateMemberNetBalances(txs, [], customMembers, 'ws-1', [], []);
    // Com desempate por id ASC:
    // Credores empatados (100 cada): cred-a deve vir antes de cred-b
    // Devedores empatados (100 cada): deb-a deve vir antes de deb-b
    expect(result.pairwiseDebts).toHaveLength(2);
    expect(result.pairwiseDebts[0].to_member_id).toBe('cred-a');
    expect(result.pairwiseDebts[0].from_member_id).toBe('deb-a');
  });
});
