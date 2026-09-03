'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { useTheme, Theme } from '@/lib/context/theme-context';
import {
  Settings,
  Tag,
  CreditCard,
  Database,
  Plus,
  Copy,
  Check,
  Code,
  Shield,
  FolderTree,
  Sun,
  Moon,
  Laptop,
  Palette,
} from 'lucide-react';
import { CategoryIcon } from '@/components/shared/CategoryIcon';

export default function SettingsPage() {
  const { categories, paymentMethods, addCategory, addPaymentMethod } = useFinance();
  const { theme, setTheme, resolvedTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<'categories' | 'payments' | 'appearance' | 'supabase'>('categories');

  // Category creation
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState<'expense' | 'income'>('expense');
  const [catParentId, setCatParentId] = useState('');
  const [catIcon, setCatIcon] = useState('tag');
  const [catColor, setCatColor] = useState('#10b981');
  const [isNewCatOpen, setIsNewCatOpen] = useState(false);

  // Payment method creation
  const [pmName, setPmName] = useState('');
  const [pmType, setPmType] = useState<any>('pix');
  const [isNewPmOpen, setIsNewPmOpen] = useState(false);

  const [copiedSQL, setCopiedSQL] = useState(false);

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;

    addCategory({
      name: catName.trim(),
      type: catType,
      parent_id: catParentId || null,
      icon: catIcon,
      color: catColor,
      active: true,
    });

    setCatName('');
    setCatParentId('');
    setIsNewCatOpen(false);
  };

  const handleCreatePaymentMethod = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pmName.trim()) return;

    addPaymentMethod({
      name: pmName.trim(),
      type: pmType,
      active: true,
    });

    setPmName('');
    setIsNewPmOpen(false);
  };

  const sqlSample = `-- Script de migração Supabase disponível em supabase/migrations/001_initial_schema.sql
-- Execute este script no SQL Editor do seu projeto Supabase para criar todas as 16 tabelas, RLS e RPCs.`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(sqlSample);
    setCopiedSQL(true);
    setTimeout(() => setCopiedSQL(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Configurações do Sistema
          </h2>
          <p className="text-xs text-slate-500">
            Personalize categorias, subcategorias, métodos de pagamento e integração com Supabase.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('categories')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'categories'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Tag className="h-4 w-4" />
          <span>Categorias & Subcategorias ({categories.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'payments'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <CreditCard className="h-4 w-4" />
          <span>Métodos de Pagamento ({paymentMethods.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('appearance')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'appearance'
              ? 'border-amber-500 text-amber-600 dark:text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Palette className="h-4 w-4" />
          <span>Aparência & Tema</span>
        </button>

        <button
          onClick={() => setActiveTab('supabase')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'supabase'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Database className="h-4 w-4" />
          <span>Supabase Backend & SQL</span>
        </button>
      </div>

      {/* Tab 1: Categorias */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setIsNewCatOpen(true)}
              className="flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
              <span>Nova Categoria</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categories
              .filter((c) => !c.parent_id)
              .map((cat) => (
                <div
                  key={cat.id}
                  className="rounded-3xl bg-white p-5 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800"
                >
                  <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-xl font-bold text-white shadow-sm"
                      style={{ backgroundColor: cat.color }}
                    >
                      <CategoryIcon iconName={cat.icon} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">{cat.name}</h4>
                      <span className="text-[10px] text-slate-400 font-semibold uppercase">
                        {cat.type === 'income' ? 'Receita' : 'Despesa'}
                      </span>
                    </div>
                  </div>

                  {/* Subcategorias */}
                  <div className="mt-3 space-y-1.5 pl-2">
                    {cat.subcategories && cat.subcategories.length > 0 ? (
                      cat.subcategories.map((sub) => (
                        <div
                          key={sub.id}
                          className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 py-1"
                        >
                          <span className="text-slate-300">↳</span>
                          <span>{sub.name}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-[11px] text-slate-400 italic">Sem subcategorias</p>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Tab 2: Métodos de Pagamento */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setIsNewPmOpen(true)}
              className="flex items-center gap-1.5 rounded-2xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-indigo-500"
            >
              <Plus className="h-4 w-4" />
              <span>Novo Método</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paymentMethods.map((pm) => (
              <div
                key={pm.id}
                className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 font-bold text-xs">
                    <CreditCard className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">{pm.name}</h4>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">{pm.type}</span>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  Ativo
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Aparência & Tema */}
      {activeTab === 'appearance' && (
        <div className="space-y-6">
          <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
            <div className="pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Modo de Visualização & Tema
              </h3>
              <p className="text-xs text-slate-500">
                Escolha sua preferência de visualização. O tema fica salvo especificamente para o seu usuário.
              </p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Modo Claro */}
              <div
                onClick={() => setTheme('light')}
                className={`cursor-pointer rounded-2xl p-4 border-2 transition ${
                  theme === 'light'
                    ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                    <Sun className="h-5 w-5" />
                  </div>
                  {theme === 'light' && (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
                <h4 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">Tema Claro</h4>
                <p className="text-xs text-slate-400 mt-1">Visual claro com fundos brancos e alto contraste.</p>
              </div>

              {/* Modo Escuro */}
              <div
                onClick={() => setTheme('dark')}
                className={`cursor-pointer rounded-2xl p-4 border-2 transition ${
                  theme === 'dark'
                    ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-slate-200">
                    <Moon className="h-5 w-5" />
                  </div>
                  {theme === 'dark' && (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
                <h4 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">Tema Escuro</h4>
                <p className="text-xs text-slate-400 mt-1">Interface escura confortável para os olhos à noite.</p>
              </div>

              {/* Modo Automático (Sistema) */}
              <div
                onClick={() => setTheme('system')}
                className={`cursor-pointer rounded-2xl p-4 border-2 transition ${
                  theme === 'system'
                    ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                    <Laptop className="h-5 w-5" />
                  </div>
                  {theme === 'system' && (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
                <h4 className="mt-3 text-sm font-bold text-slate-900 dark:text-white">Sincronizar com Sistema</h4>
                <p className="text-xs text-slate-400 mt-1">Segue automaticamente o modo do Windows / navegador.</p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-2 rounded-2xl bg-slate-50 p-3.5 text-xs text-slate-500 dark:bg-slate-800/40">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Tema ativo atualmente:</span>
              <span className="capitalize font-bold text-emerald-600 dark:text-emerald-400">
                {theme === 'system' ? `Sistema (${resolvedTheme === 'dark' ? 'Escuro' : 'Claro'})` : theme === 'dark' ? 'Escuro' : 'Claro'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Supabase Backend & Schema */}
      {activeTab === 'supabase' && (
        <div className="space-y-4">
          <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-200/80 dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <Database className="h-5 w-5 text-emerald-600" />
                <span>Script de Migração SQL Completo (PostgreSQL + RLS + RPCs)</span>
              </div>
              <button
                onClick={copyToClipboard}
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              >
                {copiedSQL ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                <span>{copiedSQL ? 'Copiado!' : 'Copiar Caminho'}</span>
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-slate-600 dark:text-slate-300">
              <p>
                Os scripts de migração sequenciais contendo todas as <strong>16 tabelas</strong>, políticas <strong>RLS</strong>, <strong>funções atômicas RPC</strong> e regras de endurecimento estão salvos em:
              </p>
              <div className="space-y-1 rounded-2xl bg-slate-900 p-4 font-mono text-xs text-emerald-400 overflow-x-auto">
                <div>1. supabase/migrations/001_initial_schema.sql (Schema Base)</div>
                <div>2. supabase/migrations/002_v5_hardening.sql (Hardening e Integridade)</div>
                <div>3. supabase/migrations/003_v7_hardening.sql (Parcelas Já Pagas)</div>
                <div>4. supabase/migrations/004_v9_rpc_and_schema_alignment.sql (RPCs Alinhadas)</div>
                <div>5. supabase/migrations/005_v10_hardening.sql (Segurança e Triggers Estruturais)</div>
              </div>

              <div className="pt-2">
                <h5 className="font-bold text-slate-900 dark:text-white">Para conectar seu Supabase real:</h5>
                <ol className="mt-2 list-decimal list-inside space-y-1.5 text-slate-500">
                  <li>Acesse seu painel no <strong>supabase.com</strong>.</li>
                  <li>Abra o <strong>SQL Editor</strong> e execute as migrations <code>001</code> a <code>005</code> em ordem sequencial.</li>
                  <li>Preencha seu <code>NEXT_PUBLIC_SUPABASE_URL</code> e <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> no arquivo <code>.env.local</code>.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nova Categoria */}
      {isNewCatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Cadastrar Nova Categoria</h3>
            <form onSubmit={handleCreateCategory} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Nome</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Assinaturas / Streaming"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">Tipo</label>
                  <select
                    value={catType}
                    onChange={(e) => setCatType(e.target.value as any)}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="expense">Despesa</option>
                    <option value="income">Receita</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">Categoria Pai (Opcional)</label>
                  <select
                    value={catParentId}
                    onChange={(e) => setCatParentId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="">Nenhuma (Categoria Principal)</option>
                    {categories
                      .filter((c) => !c.parent_id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsNewCatOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                >
                  Salvar Categoria
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Novo Método */}
      {isNewPmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Cadastrar Método de Pagamento</h3>
            <form onSubmit={handleCreatePaymentMethod} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Nome do Método</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: PIX Banco Inter, Cartão C6"
                  value={pmName}
                  onChange={(e) => setPmName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">Tipo</label>
                <select
                  value={pmType}
                  onChange={(e) => setPmType(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="pix">PIX</option>
                  <option value="credit_card">Cartão de Crédito</option>
                  <option value="debit_card">Cartão de Débito</option>
                  <option value="cash">Dinheiro em Espécie</option>
                  <option value="boleto">Boleto Bancário</option>
                  <option value="automatic_debit">Débito Automático</option>
                  <option value="other">Outro</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsNewPmOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-500"
                >
                  Salvar Método
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
