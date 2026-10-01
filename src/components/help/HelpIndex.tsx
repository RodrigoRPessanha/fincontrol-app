'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import type { HelpArticle } from '@/lib/help/articles';

export type HelpSearchEntry = Pick<HelpArticle, 'slug' | 'title' | 'summary' | 'category'> & { searchText: string };

function normalize(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function HelpIndex({ articles }: { articles: HelpSearchEntry[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const categories = [...new Set(articles.map((article) => article.category))];
  const search = normalize(query.trim());
  const results = articles.filter((article) => (!category || article.category === category) && normalize(article.searchText).includes(search));

  return (
    <div className="mt-8">
      <label htmlFor="busca-ajuda" className="block text-sm font-semibold">Buscar nos guias publicados</label>
      <div className="relative mt-2 max-w-xl">
        <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
        <input id="busca-ajuda" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: pendente, pessoa, saldo…" className="min-h-12 w-full rounded-xl border border-slate-300 bg-white py-3 pl-12 pr-4 text-base placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-700 dark:bg-slate-900 dark:placeholder:text-slate-400" />
      </div>
      <label htmlFor="assunto-ajuda" className="mt-4 block text-sm font-semibold">Assunto</label>
      <select id="assunto-ajuda" value={category} onChange={(event) => setCategory(event.target.value)} className="mt-2 min-h-12 w-full max-w-xl rounded-xl border border-slate-300 bg-white px-4 py-3 text-base focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-700 dark:bg-slate-900">
        <option value="">Todos os assuntos</option>
        {categories.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <p role="status" className="mt-3 text-sm text-slate-500 dark:text-slate-400">{results.length} {results.length === 1 ? 'guia encontrado' : 'guias encontrados'}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {results.map((article) => (
          <Link key={article.slug} href={`/ajuda/${article.slug}`} className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">{article.category}</p>
            <h2 className="mt-3 text-lg font-bold">{article.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{article.summary}</p>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">Ler guia <ArrowRight aria-hidden="true" className="h-4 w-4" /></span>
          </Link>
        ))}
      </div>
      {results.length === 0 && <p className="mt-5 rounded-xl border border-slate-200 p-5 dark:border-slate-800">Nenhum guia corresponde aos filtros. Tente outra palavra ou <button type="button" onClick={() => { setQuery(''); setCategory(''); }} className="min-h-11 font-semibold text-emerald-700 underline dark:text-emerald-400">limpe os filtros</button>.</p>}
    </div>
  );
}
