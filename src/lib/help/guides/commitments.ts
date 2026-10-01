import type { HelpArticle } from '../types';

export const commitmentGuides: HelpArticle[] = [
  {
    slug: 'parcelamentos',
    title: 'Registrar e acompanhar uma compra parcelada',
    summary: 'Informe o valor total, confira as parcelas e acompanhe quanto ainda falta pagar.',
    category: 'Contas e pagamentos',
    prerequisites: 'Tenha permissão de escrita no workspace. O formulário atual cria parcelamentos pelo método de cartão de crédito; cadastre o cartão e um método de crédito antes de começar.',
    screen: '/installments', screenLabel: 'Parcelamentos',
    related: ['contas-e-cartoes', 'pagar-faturas', 'planejamento-futuro', 'dividir-despesas'],
    image: { src: '/help/parcelamentos-desktop.jpg', alt: 'Compras Parceladas e Carnês no desktop com totais contratado, quitado e restante de dados fictícios.', caption: 'Desktop: visão geral de compras parceladas de demonstração.', width: 1274, height: 896 },
    mobileImage: { src: '/help/parcelamentos-mobile.jpg', alt: 'Detalhamento de uma compra parcelada fictícia no celular, com valores, vencimentos e estados das parcelas.', caption: 'Celular: detalhe de cada parcela e indicação de pagamento pela fatura.', width: 434, height: 943 },
    sections: [
      { id: 'criar', title: 'Cadastrar a compra', steps: ['Abra Parcelamentos e escolha Nova Compra Parcelada. O formulário também pode ser aberto por Nova Transação.', 'Informe o valor total da compra e uma descrição.', 'Escolha um método de cartão de crédito e confira o cartão selecionado.', 'Informe a quantidade de parcelas e confira a prévia de valores e faturas.', 'Se estiver cadastrando uma compra antiga, informe quantas parcelas iniciais já foram pagas, quando essa opção aparecer.', 'Confira competência, categoria e eventual rateio. Salve e localize a compra em Parcelamentos.'] },
      { id: 'valores', title: 'Conferir valores e progresso', fields: [
        { name: 'Total Contratado', description: 'Soma dos valores totais das compras listadas, inclusive a parte já quitada.' },
        { name: 'Total Já Quitado / Já Pago', description: 'Valores registrados como pagos nas parcelas. Pagamentos parciais também entram no progresso por valor.' },
        { name: 'Parcelas pagas', description: 'Conta somente as parcelas totalmente quitadas. Uma parcela parcialmente paga pode aumentar o valor já pago sem aumentar essa contagem.' },
        { name: 'Restante', description: 'Total da compra menos os pagamentos registrados. Não é o saldo da conta bancária.' },
      ], note: 'O resumo “Nx de” é uma média. O cálculo preserva centavos e concentra a diferença na primeira parcela: R$ 100,00 em 3 vezes resulta em R$ 33,34, R$ 33,33 e R$ 33,33. Confira os valores no detalhamento.' },
      { id: 'pagar', title: 'Ver e pagar as parcelas', steps: ['Abra o cartão da compra ou Visualizar Todas as Parcelas.', 'Confira cada valor, vencimento e estado.', 'Se aparecer Na Fatura, pague pela fatura correspondente em Contas & Cartões.', 'Uma parcela sem vínculo de cartão pode apresentar Pagar. Nesse caso, registre somente o valor pago agora, respeitando o restante.'] },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Posso criar um carnê sem cartão?', description: 'A tela consegue mostrar parcelas sem cartão já existentes, mas Nova Compra Parcelada usa o formulário de transação, cuja criação parcelada atual depende de um cartão. Não selecione um cartão fictício para simular um carnê real.' },
        { name: 'Como a divisão considera a compra?', description: 'O balanço da divisão usa o valor total da compra e o pagador declarado, independentemente de quantas parcelas foram quitadas. Leia o guia de divisão antes de registrar acertos.' },
      ] },
    ],
  },
  {
    slug: 'recorrencias',
    title: 'Cadastrar e pausar um gasto recorrente',
    summary: 'Organize assinaturas e gastos fixos e diferencie a regra recorrente dos registros gerados.',
    category: 'Organização do mês',
    prerequisites: 'Selecione o workspace e tenha permissão de escrita. Para uma recorrência de cartão, prepare um cartão e um método de crédito válido.',
    screen: '/recurring', screenLabel: 'Recorrências',
    related: ['registrar-transacoes', 'pagar-faturas', 'planejamento-futuro'],
    image: { src: '/help/recorrencias-desktop.jpg', alt: 'Recorrências no desktop com lista de assinaturas e gastos fixos fictícios e suas frequências.', caption: 'Desktop: recorrências de demonstração e estimativas mensais.', width: 1274, height: 896 },
    mobileImage: { src: '/help/recorrencias-mobile.jpg', alt: 'Formulário Cadastrar Gasto Fixo ou Assinatura no celular com frequência, categoria, método e início.', caption: 'Celular: configuração de uma regra; salvar não equivale a pagar o gasto.', width: 434, height: 943 },
    sections: [
      { id: 'criar', title: 'Cadastrar a regra', steps: ['Abra Recorrências e escolha Nova Recorrência.', 'Escolha Despesa ou Receita e preencha descrição e valor por ocorrência.', 'Selecione a frequência: semanal, mensal, bimestral, trimestral, semestral ou anual.', 'Confira categoria, método e conta. Em despesas de crédito, confira o cartão: métodos com cartão fixo usam o cartão vinculado; os genéricos exigem seleção.', 'Informe Data de Início / Próxima e salve.', 'Confira a regra na lista e os registros gerados em Transações ou na fatura do cartão.'] },
      { id: 'geracao', title: 'Regra não é pagamento', paragraphs: ['A recorrência descreve o que se repete. O sistema gera registros conforme as ocorrências programadas; cadastrar a regra não confirma pagamento nem recebimento.', 'Para datas mensais em dias inexistentes, como dia 31 em fevereiro, o cálculo usa o último dia do mês e preserva o dia original como referência para os meses seguintes.'], note: 'Confira Transações antes de lançar manualmente o mesmo gasto. Se uma ocorrência esperada ainda não aparecer, confirme a data inicial, o estado ativo e atualize a tela antes de duplicar o registro.' },
      { id: 'pausar', title: 'Pausar ou reativar', steps: ['Localize a regra na tabela. No celular, deslize a tabela para alcançar as ações.', 'Use a ação Pausar recorrência para interromper novas gerações e sua projeção enquanto estiver inativa.', 'Use Reativar recorrência para voltar a utilizá-la. Confira a próxima data e os registros gerados após reativar.'], note: 'Pausar não cancela nem apaga os registros já gerados. Ao reativar, podem existir ocorrências anteriores ainda não geradas; não presuma que a regra recomeçará somente no mês seguinte.' },
      { id: 'estimativas', title: 'Entender os totais mensais', paragraphs: ['Os totais de despesas e receitas fixas convertem as regras ativas para uma base mensal aproximada. Uma regra anual é dividida por 12; uma semanal é estimada por 52 semanas por ano.', 'Esses valores servem para comparação. Não são o total exato pago no mês; use Transações e Relatórios para conferir os registros do período.'] },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Receita pode usar cartão de crédito?', description: 'Não. Ao escolher Receita, os métodos de cartão são excluídos do formulário.' },
        { name: 'Quero encerrar uma assinatura', description: 'Pausar interrompe a regra no FinControl, mas não cancela o serviço no fornecedor. Confira também os registros pendentes que já foram gerados.' },
      ] },
    ],
  },
];
