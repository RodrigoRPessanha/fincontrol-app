import { SupabaseClient } from '@supabase/supabase-js';
import { Database, Json } from '../supabase/database.types';
import {
  Account,
  Budget,
  Category,
  CreditCard,
  CreditCardBill,
  FinancialGoal,
  Installment,
  Payment,
  PaymentMethod,
  Purchase,
  RecurringTransaction,
  Settlement,
  Transaction,
  Transfer,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from '../types';
import { FinanceState } from '../context/finance-state';
import { FinanceRepository } from './finance-repository';
import { RepositoryError } from './repository-errors';
import { roundCurrency } from '../financial-engine';
import {
  mapAccountRowToDomain,
  mapDomainToAccountInsert,
  mapCategoryRowToDomain,
  mapDomainToCategoryInsert,
  mapCreditCardRowToDomain,
  mapDomainToCreditCardInsert,
  mapCreditCardBillRowToDomain,
  mapDomainToFinancialGoalInsert,
  mapFinancialGoalRowToDomain,
  mapDomainToBudgetInsert,
  mapBudgetRowToDomain,
  mapPaymentMethodRowToDomain,
  mapDomainToPaymentMethodInsert,
  mapPaymentRowToDomain,
  mapDomainToPaymentInsert,
  mapPurchaseRowToDomain,
  mapDomainToPurchaseInsert,
  mapInstallmentRowToDomain,
  mapRecurringRowToDomain,
  mapDomainToRecurringInsert,
  mapSettlementRowToDomain,
  mapDomainToSettlementInsert,
  mapTransactionRowToDomain,
  mapDomainToTransactionInsert,
  mapTransferRowToDomain,
  mapDomainToTransferInsert,
  mapWorkspaceRowToDomain,
  mapDomainToWorkspaceInsert,
  mapWorkspaceMemberRowToDomain,
  mapDomainToWorkspaceMemberInsert,
} from './mappers';

type DbTables = Database['public']['Tables'];

/**
 * Implementação remota de FinanceRepository para Supabase Cloud / PostgreSQL.
 * Realiza batching de snapshot em paralelo (sem N+1), usa RPCs para consistência atômica,
 * e converte erros do PostgREST em RepositoryError tipados.
 */
export class SupabaseFinanceRepository implements FinanceRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  // ==========================================
  // Snapshot consolidado de um workspace
  // ==========================================
  async loadSnapshot(workspaceId: string): Promise<FinanceState> {
    const [
      wsRes,
      membersRes,
      accRes,
      cardsRes,
      billsRes,
      methodsRes,
      catsRes,
      txsRes,
      txSplitsRes,
      purchasesRes,
      pSplitsRes,
      paymentsRes,
      transfersRes,
      recurringRes,
      budgetsRes,
      goalsRes,
      settlementsRes,
    ] = await Promise.all([
      this.client.from('workspaces').select('*'),
      this.client
        .from('workspace_members')
        .select('*, profiles(*)')
        .eq('workspace_id', workspaceId),
      this.client.from('accounts').select('*').eq('workspace_id', workspaceId),
      this.client.from('credit_cards').select('*').eq('workspace_id', workspaceId),
      this.client.from('credit_card_bills').select('*').eq('workspace_id', workspaceId),
      this.client.from('payment_methods').select('*').eq('workspace_id', workspaceId),
      this.client.from('categories').select('*').eq('workspace_id', workspaceId),
      this.client.from('transactions').select('*').eq('workspace_id', workspaceId),
      this.client.from('transaction_splits').select('*').eq('workspace_id', workspaceId),
      this.client.from('purchases').select('*').eq('workspace_id', workspaceId),
      this.client.from('purchase_splits').select('*').eq('workspace_id', workspaceId),
      this.client.from('payments').select('*').eq('workspace_id', workspaceId),
      this.client.from('transfers').select('*').eq('workspace_id', workspaceId),
      this.client.from('recurring_transactions').select('*').eq('workspace_id', workspaceId),
      this.client.from('budgets').select('*').eq('workspace_id', workspaceId),
      this.client.from('financial_goals').select('*').eq('workspace_id', workspaceId),
      this.client.from('settlements').select('*').eq('workspace_id', workspaceId),
    ]);

    if (wsRes.error) throw RepositoryError.fromPostgrestError(wsRes.error, 'workspaces');
    if (membersRes.error) throw RepositoryError.fromPostgrestError(membersRes.error, 'workspace_members');
    if (accRes.error) throw RepositoryError.fromPostgrestError(accRes.error, 'accounts');
    if (cardsRes.error) throw RepositoryError.fromPostgrestError(cardsRes.error, 'credit_cards');
    if (billsRes.error) throw RepositoryError.fromPostgrestError(billsRes.error, 'credit_card_bills');
    if (methodsRes.error) throw RepositoryError.fromPostgrestError(methodsRes.error, 'payment_methods');
    if (catsRes.error) throw RepositoryError.fromPostgrestError(catsRes.error, 'categories');
    if (txsRes.error) throw RepositoryError.fromPostgrestError(txsRes.error, 'transactions');
    if (txSplitsRes.error) throw RepositoryError.fromPostgrestError(txSplitsRes.error, 'transaction_splits');
    if (purchasesRes.error) throw RepositoryError.fromPostgrestError(purchasesRes.error, 'purchases');
    if (pSplitsRes.error) throw RepositoryError.fromPostgrestError(pSplitsRes.error, 'purchase_splits');
    if (paymentsRes.error) throw RepositoryError.fromPostgrestError(paymentsRes.error, 'payments');
    if (transfersRes.error) throw RepositoryError.fromPostgrestError(transfersRes.error, 'transfers');
    if (recurringRes.error) throw RepositoryError.fromPostgrestError(recurringRes.error, 'recurring_transactions');
    if (budgetsRes.error) throw RepositoryError.fromPostgrestError(budgetsRes.error, 'budgets');
    if (goalsRes.error) throw RepositoryError.fromPostgrestError(goalsRes.error, 'financial_goals');
    if (settlementsRes.error) throw RepositoryError.fromPostgrestError(settlementsRes.error, 'settlements');

    // Carrega parcelas das compras deste workspace
    const purchaseIds = (purchasesRes.data ?? []).map((p) => p.id);
    let installmentsRows: DbTables['installments']['Row'][] = [];
    if (purchaseIds.length > 0) {
      const instRes = await this.client
        .from('installments')
        .select('*')
        .in('purchase_id', purchaseIds);
      if (instRes.error) throw RepositoryError.fromPostgrestError(instRes.error, 'installments');
      installmentsRows = instRes.data ?? [];
    }

    // Indexa splits por transação / compra
    const splitsByTx = new Map<string, DbTables['transaction_splits']['Row'][]>();
    for (const split of txSplitsRes.data ?? []) {
      const existing = splitsByTx.get(split.transaction_id) ?? [];
      existing.push(split);
      splitsByTx.set(split.transaction_id, existing);
    }

    const splitsByPurchase = new Map<string, DbTables['purchase_splits']['Row'][]>();
    for (const split of pSplitsRes.data ?? []) {
      const existing = splitsByPurchase.get(split.purchase_id) ?? [];
      existing.push(split);
      splitsByPurchase.set(split.purchase_id, existing);
    }

    return {
      activeWorkspaceId: workspaceId,
      allWorkspaces: (wsRes.data ?? []).map(mapWorkspaceRowToDomain),
      allWorkspaceMembers: (membersRes.data ?? []).map((m: any) => {
        const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
        return mapWorkspaceMemberRowToDomain(m, profile);
      }),
      allAccounts: (accRes.data ?? []).map(mapAccountRowToDomain),
      allCreditCards: (cardsRes.data ?? []).map(mapCreditCardRowToDomain),
      allCreditCardBills: (billsRes.data ?? []).map(mapCreditCardBillRowToDomain),
      allPaymentMethods: (methodsRes.data ?? []).map(mapPaymentMethodRowToDomain),
      allCategories: (catsRes.data ?? []).map(mapCategoryRowToDomain),
      allTransactions: (txsRes.data ?? []).map((tx) =>
        mapTransactionRowToDomain(tx, splitsByTx.get(tx.id) ?? [])
      ),
      allPurchases: (purchasesRes.data ?? []).map((p) =>
        mapPurchaseRowToDomain(p, splitsByPurchase.get(p.id) ?? [])
      ),
      allInstallments: installmentsRows.map(mapInstallmentRowToDomain),
      allPayments: (paymentsRes.data ?? []).map(mapPaymentRowToDomain),
      allTransfers: (transfersRes.data ?? []).map(mapTransferRowToDomain),
      allRecurring: (recurringRes.data ?? []).map(mapRecurringRowToDomain),
      allBudgets: (budgetsRes.data ?? []).map(mapBudgetRowToDomain),
      allGoals: (goalsRes.data ?? []).map(mapFinancialGoalRowToDomain),
      allSettlements: (settlementsRes.data ?? []).map(mapSettlementRowToDomain),
    };
  }

  // ==========================================
  // Workspaces e Membros
  // ==========================================
  async getWorkspaces(_userId?: string): Promise<Workspace[]> {
    const { data, error } = await this.client.from('workspaces').select('*');
    if (error) throw RepositoryError.fromPostgrestError(error, 'workspaces');
    return (data ?? []).map(mapWorkspaceRowToDomain);
  }

  async createWorkspace(workspace: Omit<Workspace, 'id' | 'created_at'>): Promise<Workspace> {
    const { data: wsId, error: rpcErr } = await this.client.rpc('fn_create_workspace', {
      p_name: workspace.name,
      p_currency: workspace.currency ?? 'BRL',
      p_tracking_mode: workspace.tracking_mode ?? 'full',
    });

    if (rpcErr || !wsId) {
      throw RepositoryError.fromPostgrestError(
        rpcErr ?? { message: 'Falha ao criar workspace no banco' },
        'workspaces'
      );
    }

    const { data: wsData, error: fetchErr } = await this.client
      .from('workspaces')
      .select('*')
      .eq('id', wsId)
      .single();
    if (fetchErr) throw RepositoryError.fromPostgrestError(fetchErr, 'workspaces');
    return mapWorkspaceRowToDomain(wsData);
  }

  async updateWorkspace(id: string, updates: Partial<Workspace>): Promise<Workspace> {
    const { data, error } = await this.client
      .from('workspaces')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'workspaces');
    return mapWorkspaceRowToDomain(data);
  }

  async deleteWorkspace(id: string): Promise<void> {
    const { error } = await this.client.from('workspaces').delete().eq('id', id);
    if (error) throw RepositoryError.fromPostgrestError(error, 'workspaces');
  }

  async getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const { data, error } = await this.client
      .from('workspace_members')
      .select('*, profiles(*)')
      .eq('workspace_id', workspaceId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'workspace_members');
    return (data ?? []).map((m: any) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return mapWorkspaceMemberRowToDomain(m, profile);
    });
  }

  async addWorkspaceMember(member: Omit<WorkspaceMember, 'id' | 'created_at'>): Promise<WorkspaceMember> {
    const isEmail = member.user_id.includes('@');
    if (isEmail && typeof this.client.rpc === 'function') {
      const { data: memberId, error: rpcErr } = await this.client.rpc('fn_add_workspace_member', {
        p_workspace_id: member.workspace_id,
        p_email_or_user_id: member.user_id,
        p_role: member.role,
      } as any);

      if (rpcErr || !memberId) {
        throw RepositoryError.fromPostgrestError(
          rpcErr ?? { message: 'Falha ao adicionar membro ao workspace' },
          'workspace_members'
        );
      }

      const { data, error: fetchErr } = await this.client
        .from('workspace_members')
        .select('*, profiles(*)')
        .eq('id', memberId)
        .single();
      if (fetchErr) throw RepositoryError.fromPostgrestError(fetchErr, 'workspace_members');
      const profile = Array.isArray((data as any).profiles) ? (data as any).profiles[0] : (data as any).profiles;
      return mapWorkspaceMemberRowToDomain(data, profile);
    }

    const insertPayload = mapDomainToWorkspaceMemberInsert(member);
    const { data, error } = await this.client
      .from('workspace_members')
      .insert(insertPayload)
      .select('*, profiles(*)')
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'workspace_members');
    const profile = Array.isArray((data as any).profiles) ? (data as any).profiles[0] : (data as any).profiles;
    return mapWorkspaceMemberRowToDomain(data, profile);
  }

  async updateWorkspaceMemberRole(id: string, role: WorkspaceRole): Promise<WorkspaceMember> {
    const { data, error } = await this.client
      .from('workspace_members')
      .update({ role })
      .eq('id', id)
      .select('*, profiles(*)')
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'workspace_members');
    const profile = Array.isArray((data as any).profiles) ? (data as any).profiles[0] : (data as any).profiles;
    return mapWorkspaceMemberRowToDomain(data, profile);
  }

  async removeWorkspaceMember(id: string): Promise<void> {
    const { error } = await this.client.from('workspace_members').delete().eq('id', id);
    if (error) throw RepositoryError.fromPostgrestError(error, 'workspace_members');
  }

  // ==========================================
  // Contas
  // ==========================================
  async getAccounts(workspaceId: string): Promise<Account[]> {
    const { data, error } = await this.client
      .from('accounts')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'accounts');
    return (data ?? []).map(mapAccountRowToDomain);
  }

  async saveAccount(account: Omit<Account, 'id' | 'created_at'> & { id?: string }): Promise<Account> {
    if (account.id) {
      const updateData: DbTables['accounts']['Update'] = {};
      if (account.name !== undefined) updateData.name = account.name;
      if (account.institution !== undefined) updateData.institution = account.institution;
      if (account.type !== undefined) updateData.type = account.type;
      if (account.color !== undefined) updateData.color = account.color;
      if (account.initial_balance !== undefined) updateData.initial_balance = roundCurrency(account.initial_balance);
      if (account.current_balance !== undefined) updateData.current_balance = roundCurrency(account.current_balance);
      if (account.active !== undefined) updateData.active = account.active;

      const { data, error } = await this.client
        .from('accounts')
        .update(updateData)
        .eq('id', account.id)
        .select()
        .single();
      if (error) throw RepositoryError.fromPostgrestError(error, 'accounts');
      return mapAccountRowToDomain(data);
    }
    const payload = mapDomainToAccountInsert(account);
    const { data, error } = await this.client
      .from('accounts')
      .insert(payload)
      .select()
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'accounts');
    return mapAccountRowToDomain(data);
  }

  async deleteAccount(id: string): Promise<void> {
    const { error } = await this.client.from('accounts').delete().eq('id', id);
    if (error) throw RepositoryError.fromPostgrestError(error, 'accounts');
  }

  // ==========================================
  // Formas de Pagamento
  // ==========================================
  async getPaymentMethods(workspaceId: string): Promise<PaymentMethod[]> {
    const { data, error } = await this.client
      .from('payment_methods')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'payment_methods');
    return (data ?? []).map(mapPaymentMethodRowToDomain);
  }

  async savePaymentMethod(method: Omit<PaymentMethod, 'id' | 'created_at'> & { id?: string }): Promise<PaymentMethod> {
    const payload = mapDomainToPaymentMethodInsert(method);
    if (method.id) {
      const { data, error } = await this.client
        .from('payment_methods')
        .update(payload)
        .eq('id', method.id)
        .select()
        .single();
      if (error) throw RepositoryError.fromPostgrestError(error, 'payment_methods');
      return mapPaymentMethodRowToDomain(data);
    }
    const { data, error } = await this.client
      .from('payment_methods')
      .insert(payload)
      .select()
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'payment_methods');
    return mapPaymentMethodRowToDomain(data);
  }

  async deletePaymentMethod(id: string): Promise<void> {
    const { error } = await this.client.from('payment_methods').delete().eq('id', id);
    if (error) throw RepositoryError.fromPostgrestError(error, 'payment_methods');
  }

  // ==========================================
  // Cartões de Crédito e Faturas
  // ==========================================
  async getCreditCards(workspaceId: string): Promise<CreditCard[]> {
    const { data, error } = await this.client
      .from('credit_cards')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'credit_cards');
    return (data ?? []).map(mapCreditCardRowToDomain);
  }

  async saveCreditCard(card: Omit<CreditCard, 'id' | 'created_at'> & { id?: string }): Promise<CreditCard> {
    if (card.id) {
      const updateData: DbTables['credit_cards']['Update'] = {};
      if (card.name !== undefined) updateData.name = card.name;
      if (card.institution !== undefined) updateData.institution = card.institution;
      if (card.last_four_digits !== undefined) updateData.last_four_digits = card.last_four_digits;
      if (card.credit_limit !== undefined) updateData.credit_limit = roundCurrency(card.credit_limit);
      if (card.closing_day !== undefined) updateData.closing_day = card.closing_day;
      if (card.due_day !== undefined) updateData.due_day = card.due_day;
      if (card.linked_payment_account_id !== undefined) updateData.linked_payment_account_id = card.linked_payment_account_id;
      if (card.color !== undefined) updateData.color = card.color;
      if (card.active !== undefined) updateData.active = card.active;

      const { data, error } = await this.client
        .from('credit_cards')
        .update(updateData)
        .eq('id', card.id)
        .select()
        .single();
      if (error) throw RepositoryError.fromPostgrestError(error, 'credit_cards');
      return mapCreditCardRowToDomain(data);
    }
    const payload = mapDomainToCreditCardInsert(card);
    const { data, error } = await this.client
      .from('credit_cards')
      .insert(payload)
      .select()
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'credit_cards');
    return mapCreditCardRowToDomain(data);
  }

  async deleteCreditCard(id: string): Promise<void> {
    const { error } = await this.client.from('credit_cards').delete().eq('id', id);
    if (error) throw RepositoryError.fromPostgrestError(error, 'credit_cards');
  }

  async getCreditCardBills(creditCardId: string): Promise<CreditCardBill[]> {
    const { data, error } = await this.client
      .from('credit_card_bills')
      .select('*')
      .eq('credit_card_id', creditCardId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'credit_card_bills');
    return (data ?? []).map(mapCreditCardBillRowToDomain);
  }

  // ==========================================
  // Categorias
  // ==========================================
  async getCategories(workspaceId: string): Promise<Category[]> {
    const { data, error } = await this.client
      .from('categories')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'categories');
    return (data ?? []).map(mapCategoryRowToDomain);
  }

  async saveCategory(category: Omit<Category, 'id' | 'created_at'> & { id?: string }): Promise<Category> {
    if (category.id) {
      const updateData: DbTables['categories']['Update'] = {};
      if (category.name !== undefined) updateData.name = category.name;
      if (category.parent_id !== undefined) updateData.parent_id = category.parent_id;
      if (category.icon !== undefined) updateData.icon = category.icon;
      if (category.color !== undefined) updateData.color = category.color;
      if (category.type !== undefined) updateData.type = category.type;
      if (category.active !== undefined) updateData.active = category.active;

      const { data, error } = await this.client
        .from('categories')
        .update(updateData)
        .eq('id', category.id)
        .select()
        .single();
      if (error) throw RepositoryError.fromPostgrestError(error, 'categories');
      return mapCategoryRowToDomain(data);
    }
    const payload = mapDomainToCategoryInsert(category);
    const { data, error } = await this.client
      .from('categories')
      .insert(payload)
      .select()
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'categories');
    return mapCategoryRowToDomain(data);
  }

  async deleteCategory(id: string): Promise<void> {
    const { error } = await this.client.from('categories').delete().eq('id', id);
    if (error) throw RepositoryError.fromPostgrestError(error, 'categories');
  }

  // ==========================================
  // Transações
  // ==========================================
  async getTransactions(workspaceId: string): Promise<Transaction[]> {
    const [txsRes, splitsRes] = await Promise.all([
      this.client.from('transactions').select('*').eq('workspace_id', workspaceId),
      this.client.from('transaction_splits').select('*').eq('workspace_id', workspaceId),
    ]);
    if (txsRes.error) throw RepositoryError.fromPostgrestError(txsRes.error, 'transactions');
    if (splitsRes.error) throw RepositoryError.fromPostgrestError(splitsRes.error, 'transaction_splits');

    const splitsByTx = new Map<string, DbTables['transaction_splits']['Row'][]>();
    for (const split of splitsRes.data ?? []) {
      const existing = splitsByTx.get(split.transaction_id) ?? [];
      existing.push(split);
      splitsByTx.set(split.transaction_id, existing);
    }

    return (txsRes.data ?? []).map((tx) =>
      mapTransactionRowToDomain(tx, splitsByTx.get(tx.id) ?? [])
    );
  }

  async saveTransaction(transaction: Omit<Transaction, 'id' | 'created_at'> & { id?: string }): Promise<Transaction> {
    let savedRow: DbTables['transactions']['Row'];

    if (transaction.id) {
      const { data: updatedId, error: rpcErr } = await this.client.rpc('fn_update_transaction_with_splits', {
        p_workspace_id: transaction.workspace_id,
        p_transaction_id: transaction.id,
        p_description: transaction.description,
        p_amount: transaction.amount,
        p_transaction_date: transaction.transaction_date,
        p_due_date: transaction.due_date,
        p_type: transaction.type,
        p_category_id: (transaction.category_id ?? null) as string | null,
        p_account_id: (transaction.account_id ?? null) as string | null,
        p_payment_method_id: (transaction.payment_method_id ?? null) as string | null,
        p_credit_card_id: (transaction.credit_card_id ?? null) as string | null,
        p_credit_card_bill_id: (transaction.credit_card_bill_id ?? null) as string | null,
        p_notes: (transaction.notes ?? null) as string | null,
        p_paid_by_member_id: (transaction.paid_by_member_id ?? null) as string | null,
        p_split_type: (transaction.split_type ?? null) as string | null,
        p_splits: transaction.splits !== undefined ? (transaction.splits as unknown as Json) : undefined,
      } as any);

      if (rpcErr || !updatedId) {
        throw RepositoryError.fromPostgrestError(rpcErr ?? { message: 'Falha ao atualizar transação atômica com rateios' }, 'transactions');
      }

      const { data: fetchRow, error: fetchErr } = await this.client
        .from('transactions')
        .select('*')
        .eq('id', updatedId)
        .single();
      if (fetchErr) throw RepositoryError.fromPostgrestError(fetchErr, 'transactions');
      savedRow = fetchRow;
    } else {
      // Criação 100% atômica via RPC fn_create_transaction_with_splits:
      // grava a transação e seus rateios na mesma transação SQL.
      // Se os rateios violarem soma ou integridade, a transação sofre rollback total.
      const { data: txId, error: rpcErr } = await this.client.rpc('fn_create_transaction_with_splits', {
        p_workspace_id: transaction.workspace_id,
        p_description: transaction.description,
        p_amount: transaction.amount,
        p_transaction_date: transaction.transaction_date,
        p_due_date: transaction.due_date,
        p_type: transaction.type,
        p_status: transaction.status,
        p_category_id: (transaction.category_id ?? null) as string | null,
        p_account_id: (transaction.account_id ?? null) as string | null,
        p_payment_method_id: (transaction.payment_method_id ?? null) as string | null,
        p_credit_card_id: (transaction.credit_card_id ?? null) as string | null,
        p_credit_card_bill_id: (transaction.credit_card_bill_id ?? null) as string | null,
        p_notes: (transaction.notes ?? null) as string | null,
        p_paid_by_member_id: (transaction.paid_by_member_id ?? null) as string | null,
        p_split_type: (transaction.split_type ?? null) as string | null,
        p_splits: (transaction.splits ?? []) as unknown as Json,
      } as any);

      if (rpcErr || !txId) {
        throw RepositoryError.fromPostgrestError(rpcErr ?? { message: 'Falha ao criar transação atômica com rateios' }, 'transactions');
      }

      const { data: fetchRow, error: fetchErr } = await this.client
        .from('transactions')
        .select('*')
        .eq('id', txId)
        .single();
      if (fetchErr) throw RepositoryError.fromPostgrestError(fetchErr, 'transactions');
      savedRow = fetchRow;
    }

    return {
      ...mapTransactionRowToDomain(savedRow),
      splits: transaction.splits,
    };
  }

  async deleteTransaction(id: string): Promise<void> {
    const { data: tx, error: fetchErr } = await this.client
      .from('transactions')
      .select('workspace_id')
      .eq('id', id)
      .single();
    if (fetchErr || !tx) {
      throw new RepositoryError(`Transação com id ${id} não encontrada`, 'NOT_FOUND', fetchErr, 'transactions');
    }

    const { error: rpcErr } = await this.client.rpc('fn_delete_transaction', {
      p_workspace_id: tx.workspace_id,
      p_transaction_id: id,
    });
    if (rpcErr) throw RepositoryError.fromPostgrestError(rpcErr, 'transactions');
  }

  // ==========================================
  // Compras Parceladas e Parcelas
  // ==========================================
  async getPurchases(workspaceId: string): Promise<Purchase[]> {
    const [purchasesRes, splitsRes] = await Promise.all([
      this.client.from('purchases').select('*').eq('workspace_id', workspaceId),
      this.client.from('purchase_splits').select('*').eq('workspace_id', workspaceId),
    ]);
    if (purchasesRes.error) throw RepositoryError.fromPostgrestError(purchasesRes.error, 'purchases');
    if (splitsRes.error) throw RepositoryError.fromPostgrestError(splitsRes.error, 'purchase_splits');

    const splitsByPurchase = new Map<string, DbTables['purchase_splits']['Row'][]>();
    for (const split of splitsRes.data ?? []) {
      const existing = splitsByPurchase.get(split.purchase_id) ?? [];
      existing.push(split);
      splitsByPurchase.set(split.purchase_id, existing);
    }

    return (purchasesRes.data ?? []).map((p) =>
      mapPurchaseRowToDomain(p, splitsByPurchase.get(p.id) ?? [])
    );
  }

  async savePurchase(purchase: Omit<Purchase, 'id' | 'created_at'> & { id?: string }): Promise<Purchase> {
    let savedRow: DbTables['purchases']['Row'];

    if (purchase.id) {
      const { data: updatedId, error: rpcErr } = await this.client.rpc('fn_update_purchase_with_splits', {
        p_workspace_id: purchase.workspace_id,
        p_purchase_id: purchase.id,
        p_description: purchase.description,
        p_total_amount: purchase.total_amount,
        p_purchase_date: purchase.purchase_date,
        p_category_id: (purchase.category_id ?? null) as string | null,
        p_account_id: (purchase.account_id ?? null) as string | null,
        p_payment_method_id: (purchase.payment_method_id ?? null) as string | null,
        p_credit_card_id: (purchase.credit_card_id ?? null) as string | null,
        p_paid_by_member_id: (purchase.paid_by_member_id ?? null) as string | null,
        p_split_type: (purchase.split_type ?? null) as string | null,
        p_splits: purchase.splits !== undefined ? (purchase.splits as unknown as Json) : undefined,
      } as any);

      if (rpcErr || !updatedId) {
        throw RepositoryError.fromPostgrestError(rpcErr ?? { message: 'Falha ao atualizar compra atômica com rateios' }, 'purchases');
      }

      const { data: fetchRow, error: fetchErr } = await this.client
        .from('purchases')
        .select('*')
        .eq('id', updatedId)
        .single();
      if (fetchErr) throw RepositoryError.fromPostgrestError(fetchErr, 'purchases');
      savedRow = fetchRow;
    } else {
      // Criação 100% atômica via RPC fn_create_purchase_with_splits:
      // gera a compra, suas parcelas e seus rateios em uma única transação SQL.
      // Se qualquer regra falhar, nada é persistido.
      const { data: purchaseId, error: rpcErr } = await this.client.rpc('fn_create_purchase_with_splits', {
        p_workspace_id: purchase.workspace_id,
        p_description: purchase.description,
        p_total_amount: purchase.total_amount,
        p_installment_count: purchase.installment_count,
        p_purchase_date: purchase.purchase_date,
        p_credit_card_id: (purchase.credit_card_id ?? null) as string | null,
        p_category_id: (purchase.category_id ?? null) as string | null,
        p_account_id: (purchase.account_id ?? null) as string | null,
        p_payment_method_id: (purchase.payment_method_id ?? null) as string | null,
        p_paid_installments_count: purchase.paid_installments_count ?? 0,
        p_paid_by_member_id: (purchase.paid_by_member_id ?? null) as string | null,
        p_split_type: (purchase.split_type ?? null) as string | null,
        p_splits: (purchase.splits ?? []) as unknown as Json,
      } as any);

      if (rpcErr || !purchaseId) {
        throw RepositoryError.fromPostgrestError(rpcErr ?? { message: 'Falha ao criar compra atômica com rateios' }, 'purchases');
      }

      const { data: fetchRow, error: fetchErr } = await this.client
        .from('purchases')
        .select('*')
        .eq('id', purchaseId)
        .single();
      if (fetchErr) throw RepositoryError.fromPostgrestError(fetchErr, 'purchases');
      savedRow = fetchRow;
    }

    return {
      ...mapPurchaseRowToDomain(savedRow),
      splits: purchase.splits,
    };
  }

  async deletePurchase(id: string): Promise<void> {
    const { data: purchase, error: fetchErr } = await this.client
      .from('purchases')
      .select('workspace_id')
      .eq('id', id)
      .single();
    if (fetchErr || !purchase) {
      throw new RepositoryError(`Compra com id ${id} não encontrada`, 'NOT_FOUND', fetchErr, 'purchases');
    }

    const { error: rpcErr } = await this.client.rpc('fn_delete_purchase', {
      p_workspace_id: purchase.workspace_id,
      p_purchase_id: id,
    });
    if (rpcErr) throw RepositoryError.fromPostgrestError(rpcErr, 'purchases');
  }

  async getInstallments(purchaseId: string): Promise<Installment[]> {
    const { data, error } = await this.client
      .from('installments')
      .select('*')
      .eq('purchase_id', purchaseId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'installments');
    return (data ?? []).map(mapInstallmentRowToDomain);
  }

  // ==========================================
  // Pagamentos
  // ==========================================
  async getPayments(workspaceId: string): Promise<Payment[]> {
    const { data, error } = await this.client
      .from('payments')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'payments');
    return (data ?? []).map(mapPaymentRowToDomain);
  }

  async savePayment(payment: Omit<Payment, 'id' | 'created_at'> & { id?: string }): Promise<Payment> {
    if (payment.id) {
      const { data: updatedId, error: rpcErr } = await this.client.rpc('fn_update_payment', {
        p_workspace_id: payment.workspace_id,
        p_payment_id: payment.id,
        p_account_id: (payment.account_id ?? null) as any,
        p_amount: payment.amount,
        p_payment_date: payment.payment_date,
        p_payment_method_id: (payment.payment_method_id ?? null) as any,
        p_notes: (payment.notes ?? null) as string | null,
        p_affects_balance: payment.affects_balance,
      } as any);

      if (rpcErr || !updatedId) {
        throw RepositoryError.fromPostgrestError(rpcErr ?? { message: 'Falha ao atualizar pagamento atômico' }, 'payments');
      }

      const { data: fetchRow, error: fetchErr } = await this.client
        .from('payments')
        .select('*')
        .eq('id', updatedId)
        .single();
      if (fetchErr) throw RepositoryError.fromPostgrestError(fetchErr, 'payments');
      return mapPaymentRowToDomain(fetchRow);
    }

    // Se possui obrigação de destino (fatura, parcela ou transação),
    // executa a RPC atômica fn_record_payment que abate o saldo bancário
    // e atualiza o status/valor pago da obrigação na mesma transação SQL.
    const hasObligation = Boolean(payment.transaction_id || payment.installment_id || payment.credit_card_bill_id);
    if (hasObligation) {
      const { data: paymentId, error: rpcErr } = await this.client.rpc('fn_record_payment', {
        p_workspace_id: payment.workspace_id,
        p_account_id: (payment.account_id ?? null) as any,
        p_amount: payment.amount,
        p_payment_date: payment.payment_date,
        p_transaction_id: (payment.transaction_id ?? null) as string | null,
        p_installment_id: (payment.installment_id ?? null) as string | null,
        p_credit_card_bill_id: (payment.credit_card_bill_id ?? null) as string | null,
        p_payment_method_id: (payment.payment_method_id ?? null) as string | null,
        p_notes: (payment.notes ?? null) as string | null,
        p_affects_balance: payment.affects_balance,
      } as any);

      if (rpcErr || !paymentId) {
        throw RepositoryError.fromPostgrestError(rpcErr ?? { message: 'Falha ao registrar pagamento atômico' }, 'payments');
      }

      const { data: fetchRow, error: fetchErr } = await this.client
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();
      if (fetchErr) throw RepositoryError.fromPostgrestError(fetchErr, 'payments');
      return mapPaymentRowToDomain(fetchRow);
    }

    // Pagamento avulso sem obrigação
    const payload = mapDomainToPaymentInsert(payment);
    const { data, error } = await this.client
      .from('payments')
      .insert(payload)
      .select()
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'payments');
    return mapPaymentRowToDomain(data);
  }

  async deletePayment(id: string): Promise<void> {
    const { data: payment, error: fetchErr } = await this.client
      .from('payments')
      .select('workspace_id')
      .eq('id', id)
      .single();
    if (fetchErr || !payment) {
      throw new RepositoryError(`Pagamento com id ${id} não encontrado`, 'NOT_FOUND', fetchErr, 'payments');
    }

    // Reversão atômica via RPC fn_delete_payment:
    // estorna o saldo da conta e reverte o status da obrigação
    const { error: rpcErr } = await this.client.rpc('fn_delete_payment', {
      p_workspace_id: payment.workspace_id,
      p_payment_id: id,
    });
    if (rpcErr) throw RepositoryError.fromPostgrestError(rpcErr, 'payments');
  }

  // ==========================================
  // Transferências
  // ==========================================
  async getTransfers(workspaceId: string): Promise<Transfer[]> {
    const { data, error } = await this.client
      .from('transfers')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'transfers');
    return (data ?? []).map(mapTransferRowToDomain);
  }

  async saveTransfer(transfer: Omit<Transfer, 'id' | 'created_at'> & { id?: string }): Promise<Transfer> {
    if (transfer.id) {
      const { data: updatedId, error: rpcErr } = await this.client.rpc('fn_update_transfer', {
        p_workspace_id: transfer.workspace_id,
        p_transfer_id: transfer.id,
        p_from_account_id: transfer.from_account_id,
        p_to_account_id: transfer.to_account_id,
        p_amount: transfer.amount,
        p_transfer_date: transfer.transfer_date,
        p_notes: (transfer.notes ?? null) as any,
      });

      if (rpcErr || !updatedId) {
        throw RepositoryError.fromPostgrestError(rpcErr ?? { message: 'Falha ao atualizar transferência atômica' }, 'transfers');
      }

      const { data: fetchRow, error: fetchErr } = await this.client
        .from('transfers')
        .select('*')
        .eq('id', updatedId)
        .single();
      if (fetchErr) throw RepositoryError.fromPostgrestError(fetchErr, 'transfers');
      return mapTransferRowToDomain(fetchRow);
    }

    // Criação atômica via RPC fn_create_transfer:
    // debita conta origem, credita conta destino e garante idempotência
    const { data: transferId, error: rpcErr } = await this.client.rpc('fn_create_transfer', {
      p_workspace_id: transfer.workspace_id,
      p_from_account_id: transfer.from_account_id,
      p_to_account_id: transfer.to_account_id,
      p_amount: transfer.amount,
      p_transfer_date: transfer.transfer_date,
      p_notes: (transfer.notes ?? null) as string | null,
      p_idempotency_key: (transfer as any).idempotency_key,
    } as any);

    if (rpcErr || !transferId) {
      throw RepositoryError.fromPostgrestError(rpcErr ?? { message: 'Falha ao criar transferência atômica' }, 'transfers');
    }

    const { data: fetchRow, error: fetchErr } = await this.client
      .from('transfers')
      .select('*')
      .eq('id', transferId)
      .single();
    if (fetchErr) throw RepositoryError.fromPostgrestError(fetchErr, 'transfers');
    return mapTransferRowToDomain(fetchRow);
  }

  async deleteTransfer(id: string): Promise<void> {
    const { data: transfer, error: fetchErr } = await this.client
      .from('transfers')
      .select('workspace_id')
      .eq('id', id)
      .single();
    if (fetchErr || !transfer) {
      throw new RepositoryError(`Transferência com id ${id} não encontrada`, 'NOT_FOUND', fetchErr, 'transfers');
    }

    // Reversão atômica via RPC fn_delete_transfer:
    // estorna os saldos entre as duas contas com deadlock prevention
    const { error: rpcErr } = await this.client.rpc('fn_delete_transfer', {
      p_workspace_id: transfer.workspace_id,
      p_transfer_id: id,
    });
    if (rpcErr) throw RepositoryError.fromPostgrestError(rpcErr, 'transfers');
  }

  // ==========================================
  // Transações Recorrentes
  // ==========================================
  async getRecurring(workspaceId: string): Promise<RecurringTransaction[]> {
    const { data, error } = await this.client
      .from('recurring_transactions')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'recurring_transactions');
    return (data ?? []).map(mapRecurringRowToDomain);
  }

  async saveRecurring(recurring: Omit<RecurringTransaction, 'id' | 'created_at'> & { id?: string }): Promise<RecurringTransaction> {
    const payload = mapDomainToRecurringInsert(recurring);
    if (recurring.id) {
      const { data, error } = await this.client
        .from('recurring_transactions')
        .update(payload)
        .eq('id', recurring.id)
        .select()
        .single();
      if (error) throw RepositoryError.fromPostgrestError(error, 'recurring_transactions');
      return mapRecurringRowToDomain(data);
    }
    const { data, error } = await this.client
      .from('recurring_transactions')
      .insert(payload)
      .select()
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'recurring_transactions');
    return mapRecurringRowToDomain(data);
  }

  async deleteRecurring(id: string): Promise<void> {
    const { error } = await this.client.from('recurring_transactions').delete().eq('id', id);
    if (error) throw RepositoryError.fromPostgrestError(error, 'recurring_transactions');
  }

  // ==========================================
  // Orçamentos e Metas
  // ==========================================
  async getBudgets(workspaceId: string): Promise<Budget[]> {
    const { data, error } = await this.client
      .from('budgets')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'budgets');
    return (data ?? []).map(mapBudgetRowToDomain);
  }

  async saveBudget(budget: Omit<Budget, 'id'> & { id?: string }): Promise<Budget> {
    if (budget.id) {
      const payload = mapDomainToBudgetInsert(budget);
      const { data, error } = await this.client
        .from('budgets')
        .update(payload)
        .eq('id', budget.id)
        .select()
        .maybeSingle();
      if (error) throw RepositoryError.fromPostgrestError(error, 'budgets');
      if (data) return mapBudgetRowToDomain(data);
    }
    const { id: _ignoredId, ...payloadWithoutId } = mapDomainToBudgetInsert(budget);
    const { data, error } = await this.client
      .from('budgets')
      .upsert(payloadWithoutId, { onConflict: 'workspace_id,category_id,month,year' })
      .select()
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'budgets');
    return mapBudgetRowToDomain(data);
  }

  async deleteBudget(id: string): Promise<void> {
    const { error } = await this.client.from('budgets').delete().eq('id', id);
    if (error) throw RepositoryError.fromPostgrestError(error, 'budgets');
  }

  async getGoals(workspaceId: string): Promise<FinancialGoal[]> {
    const { data, error } = await this.client
      .from('financial_goals')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'financial_goals');
    return (data ?? []).map(mapFinancialGoalRowToDomain);
  }

  async saveGoal(goal: Omit<FinancialGoal, 'id' | 'created_at'> & { id?: string }): Promise<FinancialGoal> {
    if (goal.id) {
      const updateData: DbTables['financial_goals']['Update'] = {};
      if (goal.name !== undefined) updateData.name = goal.name;
      if (goal.target_amount !== undefined) updateData.target_amount = roundCurrency(goal.target_amount);
      if (goal.current_amount !== undefined) updateData.current_amount = roundCurrency(goal.current_amount);
      if (goal.target_date !== undefined) updateData.target_date = goal.target_date;
      if (goal.status !== undefined) updateData.status = goal.status;
      if (goal.color !== undefined) updateData.color = goal.color;
      if (goal.icon !== undefined) updateData.icon = goal.icon;

      const { data, error } = await this.client
        .from('financial_goals')
        .update(updateData)
        .eq('id', goal.id)
        .select()
        .single();
      if (error) throw RepositoryError.fromPostgrestError(error, 'financial_goals');
      return mapFinancialGoalRowToDomain(data);
    }
    const payload = mapDomainToFinancialGoalInsert(goal);
    const { data, error } = await this.client
      .from('financial_goals')
      .insert(payload)
      .select()
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'financial_goals');
    return mapFinancialGoalRowToDomain(data);
  }

  async deleteGoal(id: string): Promise<void> {
    const { error } = await this.client.from('financial_goals').delete().eq('id', id);
    if (error) throw RepositoryError.fromPostgrestError(error, 'financial_goals');
  }

  // ==========================================
  // Acertos entre Membros (Settlements)
  // ==========================================
  async getSettlements(workspaceId: string): Promise<Settlement[]> {
    const { data, error } = await this.client
      .from('settlements')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw RepositoryError.fromPostgrestError(error, 'settlements');
    return (data ?? []).map(mapSettlementRowToDomain);
  }

  async saveSettlement(settlement: Omit<Settlement, 'id' | 'created_at'> & { id?: string }): Promise<Settlement> {
    const payload = mapDomainToSettlementInsert(settlement);
    if (settlement.id) {
      const { data, error } = await this.client
        .from('settlements')
        .update(payload)
        .eq('id', settlement.id)
        .select()
        .single();
      if (error) throw RepositoryError.fromPostgrestError(error, 'settlements');
      return mapSettlementRowToDomain(data);
    }
    const { data, error } = await this.client
      .from('settlements')
      .insert(payload)
      .select()
      .single();
    if (error) throw RepositoryError.fromPostgrestError(error, 'settlements');
    return mapSettlementRowToDomain(data);
  }

  async deleteSettlement(id: string): Promise<void> {
    const { error } = await this.client.from('settlements').delete().eq('id', id);
    if (error) throw RepositoryError.fromPostgrestError(error, 'settlements');
  }
}
