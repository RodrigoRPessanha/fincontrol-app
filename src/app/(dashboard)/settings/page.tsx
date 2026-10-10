'use client';

import React, { useState } from 'react';
import { useFinance } from '@/lib/context/finance-context';
import { useTheme } from '@/lib/context/theme-context';
import {
  Settings,
  Tag,
  CreditCard,
  Plus,
  Check,
  FolderTree,
  Sun,
  Moon,
  Laptop,
  Palette,
} from 'lucide-react';
import { PaymentMethodsSettings } from '@/components/settings/PaymentMethodsSettings';
import { CategoryIcon } from '@/components/shared/CategoryIcon';

export default function SettingsPage() {
  const { categories, allWorkspacePaymentMethods, activeWorkspace, addCategory, isWorkspaceReadOnly } = useFinance();
  const { theme, setTheme, resolvedTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<'categories' | 'payments' | 'appearance'>('categories');

  // Category creation
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState<'expense' | 'income'>('expense');
  const [catParentId, setCatParentId] = useState('');
  const [catIcon, setCatIcon] = useState('tag');
  const [catColor, setCatColor] = useState('#10b981');
  const [isNewCatOpen, setIsNewCatOpen] = useState(false);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Configurações do Sistema
          </h2>
          <p className="text-xs text-slate-500">
            Personalize categorias, subcategorias, métodos de pagamento e aparência.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 overflow-x-auto no-scrollbar scrollbar-none pb-px">
        <button
          onClick={() => setActiveTab('categories')}
          className={`flex shrink-0 whitespace-nowrap items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
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
          className={`flex shrink-0 whitespace-nowrap items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'payments'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <CreditCard className="h-4 w-4" />
          <span>Métodos de Pagamento ({allWorkspacePaymentMethods.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('appearance')}
          className={`flex shrink-0 whitespace-nowrap items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold transition ${
            activeTab === 'appearance'
              ? 'border-amber-500 text-amber-600 dark:text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Palette className="h-4 w-4" />
          <span>Aparência & Tema</span>
        </button>

      </div>

      {/* Tab 1: Categorias */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {!isWorkspaceReadOnly && <button
              onClick={() => setIsNewCatOpen(true)}
              className="flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
              <span>Nova Categoria</span>
            </button>}
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

      {activeTab === 'payments' && <PaymentMethodsSettings key={activeWorkspace.id} />}

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

      {/* Modal Nova Categoria */}
      {isNewCatOpen && !isWorkspaceReadOnly && (
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


    </div>
  );
}
