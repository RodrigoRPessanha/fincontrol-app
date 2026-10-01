import { HelpIndex } from '@/components/help/HelpIndex';
import { helpArticles } from '@/lib/help/articles';

export default function HelpPage() {
  const searchEntries = helpArticles.map((article) => ({
    slug: article.slug, title: article.title, summary: article.summary, category: article.category,
    searchText: [article.title, article.summary, article.category, article.prerequisites,
      ...article.sections.flatMap((section) => [section.title, section.note || '', ...(section.paragraphs || []), ...(section.steps || []), ...(section.fields || []).flatMap((field) => [field.name, field.description])]),
    ].join(' '),
  }));
  return (
    <>
      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Guias por tarefa</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Como podemos ajudar?</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-400">Encontre um guia para registrar gastos, dividir despesas, conferir faturas ou organizar os próximos meses. Cada tarefa explica os campos e o que conferir antes de salvar.</p>
      <HelpIndex articles={searchEntries} />
      <aside className="mt-10 rounded-2xl bg-slate-100 p-6 dark:bg-slate-900" aria-label="Conferir registros">
        <h2 className="font-semibold">Precisa conferir um valor?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">Confirme o workspace, o período e os pagamentos registrados. Saldo bancário, despesas do mês e dívidas entre pessoas são controles diferentes; os guias ajudam a interpretar cada um.</p>
      </aside>
    </>
  );
}
