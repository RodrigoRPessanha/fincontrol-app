import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getHelpArticle, helpArticles } from '@/lib/help/articles';

export function generateStaticParams() {
  return helpArticles.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = getHelpArticle((await params).slug);
  return { title: article ? `${article.title} | Ajuda FinControl` : 'Guia não encontrado | FinControl', description: article?.summary };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const article = getHelpArticle((await params).slug);
  if (!article) notFound();

  return (
    <>
      <nav aria-label="Caminho de navegação" className="mb-6 text-sm"><Link href="/ajuda" className="font-semibold text-emerald-700 underline underline-offset-4 dark:text-emerald-400">Todos os guias</Link></nav>
      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{article.category}</p>
      <h1 id="titulo-guia" className="mt-3 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">{article.title}</h1>
      <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 dark:text-slate-400">{article.summary}</p>
      <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Neste guia" className="self-start rounded-2xl border border-slate-200 bg-white p-5 lg:sticky lg:top-6 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-semibold">Neste guia</h2>
          <ul className="mt-3 space-y-1">
            {article.sections.map((section) => <li key={section.id}><a href={`#${section.id}`} className="block rounded-lg py-2 text-sm leading-5 text-slate-600 hover:text-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400">{section.title}</a></li>)}
          </ul>
        </nav>
        <article aria-labelledby="titulo-guia" className="min-w-0 max-w-3xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-semibold">Antes de começar</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{article.prerequisites}</p>
            <Link href={article.screen} className="mt-3 inline-block py-2 text-sm font-semibold text-emerald-700 underline underline-offset-4 dark:text-emerald-400">Abrir {article.screenLabel} (requer acesso ao sistema)</Link>
          </div>
          <details className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">Ver exemplos reais no desktop e no celular</summary>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">As capturas usam dados fictícios. Datas, nomes e valores são exemplos; confira os dados do seu workspace.</p>
            {[article.image, article.mobileImage].map((picture, index) => picture && (
              <figure key={picture.src} className={`mt-5 ${index === 1 ? 'max-w-sm' : ''}`}>
                <a href={picture.src} target="_blank" rel="noopener noreferrer" aria-label={`Abrir captura ${index === 0 ? 'de desktop' : 'de celular'} em tamanho original (nova aba)`} className="block rounded-xl">
                  <Image src={picture.src} alt={picture.alt} width={picture.width} height={picture.height} sizes={index === 1 ? '(max-width: 440px) 90vw, 384px' : '(max-width: 1024px) 90vw, 768px'} className="h-auto w-full rounded-xl border border-slate-200 dark:border-slate-800" />
                </a>
                <figcaption className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{picture.caption} Abra a captura para ampliar (nova aba).</figcaption>
              </figure>
            ))}
          </details>
          {article.sections.map((section) => (
            <section key={section.id} id={section.id} className="mt-9 scroll-mt-6">
              <h2 className="text-xl font-bold">{section.title}</h2>
              {section.paragraphs?.map((paragraph) => <p key={paragraph} className="mt-3 leading-7 text-slate-700 dark:text-slate-300">{paragraph}</p>)}
              {section.steps && <ol className="mt-4 list-decimal space-y-3 pl-6 text-slate-700 marker:font-semibold marker:text-emerald-700 dark:text-slate-300 dark:marker:text-emerald-400">{section.steps.map((step) => <li key={step} className="pl-2 leading-7">{step}</li>)}</ol>}
              {section.fields && <dl className="mt-4 space-y-4">{section.fields.map((field) => <div key={field.name}><dt className="font-semibold">{field.name}</dt><dd className="mt-1 leading-7 text-slate-700 dark:text-slate-300">{field.description}</dd></div>)}</dl>}
              {section.note && <aside className="mt-4 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:bg-amber-950/40 dark:text-amber-200"><strong>Atenção: </strong>{section.note}</aside>}
            </section>
          ))}
          <nav aria-label="Guias relacionados" className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
            <h2 className="font-semibold">Continue aprendendo</h2>
            <ul className="mt-3 space-y-2">{article.related.map((slug) => <li key={slug}><Link href={`/ajuda/${slug}`} className="inline-block py-2 text-emerald-700 underline underline-offset-4 dark:text-emerald-400">{getHelpArticle(slug)?.title}</Link></li>)}</ul>
          </nav>
        </article>
      </div>
    </>
  );
}
