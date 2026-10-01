import Link from 'next/link';

export default function HelpNotFound() {
  return <div className="max-w-2xl"><h1 className="text-3xl font-bold">Guia não encontrado</h1><p className="mt-4 leading-7 text-slate-600 dark:text-slate-400">Este endereço não corresponde a um guia publicado. Consulte o índice ou busque pelo assunto desejado.</p><Link href="/ajuda" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800">Voltar à central de ajuda</Link></div>;
}
