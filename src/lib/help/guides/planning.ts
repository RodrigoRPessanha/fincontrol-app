import type { HelpArticle } from '../types';

export const planningGuides: HelpArticle[] = [
  {
    slug: 'orcamentos',
    title: 'Definir um limite de gastos por categoria',
    summary: 'Compare o orçamento do mês com as despesas registradas, incluindo parcelas e pendências.',
    category: 'Organização do mês',
    prerequisites: 'Tenha categorias de despesa cadastradas no workspace e permissão de escrita para definir limites. Orçamentos estão disponíveis nos dois modos de operação.',
    screen: '/budgets', screenLabel: 'Orçamentos',
    related: ['registrar-transacoes', 'relatorios', 'planejamento-futuro'],
    image: { src: '/help/orcamentos-desktop.jpg', alt: 'Orçamentos Mensais por Categoria no desktop com limites planejados e gastos fictícios.', caption: 'Desktop: limites e gastos do mês em dados locais de demonstração.', width: 1280, height: 900 },
    mobileImage: { src: '/help/orcamentos-mobile.jpg', alt: 'Formulário de orçamento no celular com seleção de categoria e limite mensal planejado.', caption: 'Celular: definir ou substituir o limite da categoria no mês atual.', width: 434, height: 943 },
    sections: [
      { id: 'definir', title: 'Definir ou alterar um limite', steps: ['Abra Orçamentos e confira o mês exibido. A tela trabalha com o mês atual.', 'Escolha Definir Orçamento ou a ação de edição no cartão da categoria.', 'Selecione a categoria e informe o Limite Mensal Planejado, por exemplo 600,00.', 'Salve e confira o valor Planejado no cartão. Salvar novamente para a mesma categoria e mês substitui o limite anterior.'] },
      { id: 'ler', title: 'Ler os indicadores', fields: [
        { name: 'Planejado (teto de gastos)', description: 'Limite informado para a categoria naquele mês. Não separa dinheiro em uma conta nem impede novas despesas.' },
        { name: 'Gasto', description: 'Soma de despesas não canceladas pela competência da transação, mais parcelas não canceladas pelo vencimento no mês. Inclui gastos ainda pendentes e as subcategorias da categoria.' },
        { name: 'Restante', description: 'Diferença entre planejado e gasto, limitada a zero quando o gasto ultrapassa o limite. Não é o saldo bancário.' },
        { name: 'Percentual / alerta', description: 'Compara gasto com o limite cadastrado. Um aviso de excesso não bloqueia o registro da despesa.' },
      ], note: 'Sem orçamento não significa gasto zero. O gasto pode existir mesmo sem limite definido; confira o valor gasto, não somente a barra ou o percentual.' },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Por que uma despesa pendente já consome o orçamento?', description: 'O orçamento acompanha compromissos registrados, não somente pagamentos efetivados. Para conferir o que já foi quitado, use Relatórios.' },
        { name: 'A categoria não aparece', description: 'Confira se é uma categoria de despesa ativa do workspace. Cadastros de categorias ficam em Configurações.' },
        { name: 'Posso escolher outro mês nesta tela?', description: 'O formulário atual define limites do mês corrente. Não há seletor de mês em Orçamentos; Relatórios permite consultar outros períodos.' },
      ] },
    ],
  },
  {
    slug: 'planejamento-futuro',
    title: 'Conferir os compromissos dos próximos meses',
    summary: 'Veja o que já está comprometido em parcelas, faturas, recorrências e despesas em aberto.',
    category: 'Organização do mês',
    prerequisites: 'Selecione o workspace e mantenha datas, pagamentos e regras de recorrência atualizados. Consultar a projeção não exige registrar novos pagamentos.',
    screen: '/planning', screenLabel: 'Planejamento Futuro',
    related: ['parcelamentos', 'recorrencias', 'pagar-faturas', 'relatorios'],
    image: { src: '/help/planejamento-desktop.jpg', alt: 'Planejamento Futuro no desktop com horizonte e compromissos mensais de demonstração.', caption: 'Desktop: projeção com registros fictícios do workspace selecionado.', width: 1280, height: 900 },
    mobileImage: { src: '/help/planejamento-mobile.jpg', alt: 'Planejamento no celular com os seletores de três, seis e doze meses e um mês expandido.', caption: 'Celular: expanda um mês para conferir os itens que compõem a projeção.', width: 434, height: 943 },
    sections: [
      { id: 'consultar', title: 'Consultar e abrir um mês', steps: ['Abra Planejamento Futuro.', 'Escolha Próximos 3 meses, 6 meses ou 12 meses. O horizonte inclui o mês atual.', 'Confira os totais de cada mês e abra o mês desejado para ver sua composição.', 'Se encontrar um valor inesperado, confira a despesa, parcela, fatura ou recorrência na tela de origem. A projeção não é editada diretamente.'] },
      { id: 'composicao', title: 'O que entra na projeção?', fields: [
        { name: 'Parcelas e faturas', description: 'Considera o restante de parcelas sem cartão pelo vencimento e o restante das faturas pelo mês de referência. Itens do cartão entram pela fatura para evitar somá-los novamente como parcelas individuais.' },
        { name: 'Recorrências', description: 'Projeta ocorrências de regras ativas que ainda não viraram registros no mês. Ocorrências já geradas são consideradas pelos registros correspondentes.' },
        { name: 'Despesas em aberto', description: 'Inclui o restante de despesas não quitadas, pelo mês de vencimento, ou pela competência quando não há vencimento. Itens vinculados a cartão ficam na fatura.' },
        { name: 'Receitas previstas', description: 'No modo completo, receitas esperadas ajudam a comparar renda futura e comprometimento. São expectativas cadastradas, não garantia de dinheiro disponível.' },
      ], note: 'Para cartões, o mês de referência da fatura pode ser diferente do mês do vencimento. Datas exibidas em itens recorrentes da projeção são indicativas: confirme a data real no registro ou na fatura antes de pagar.' },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Posso usar para saber quanto tenho na conta?', description: 'Não. A projeção mostra compromissos e expectativas, sem prever todos os gastos futuros nem substituir o saldo em Contas & Cartões.' },
        { name: 'Por que o total diminuiu após pagar?', description: 'A projeção usa valores restantes. Pagamentos parciais reduzem o compromisso; quitação o retira dos valores em aberto.' },
        { name: 'E no modo de despesas?', description: 'A tela prioriza obrigações futuras. Você pode usá-la sem manter saldo bancário ou metas.' },
      ] },
    ],
  },
  {
    slug: 'metas',
    title: 'Criar uma meta e registrar um aporte',
    summary: 'Defina um objetivo, acompanhe o progresso e registre o valor reservado a partir de uma conta.',
    category: 'Organização do mês',
    prerequisites: 'Use o Modo Patrimonial Completo e tenha permissão de escrita. Para registrar um aporte, tenha uma conta ativa no mesmo workspace.',
    screen: '/goals', screenLabel: 'Metas',
    related: ['modos-de-operacao', 'contas-e-cartoes', 'planejamento-futuro'],
    image: { src: '/help/metas-desktop.jpg', alt: 'Metas no desktop com objetivos e progresso financeiro fictícios.', caption: 'Desktop: metas de demonstração no modo patrimonial completo.', width: 1280, height: 900 },
    mobileImage: { src: '/help/metas-mobile.jpg', alt: 'Formulário Criar Meta Financeira no celular com nome, valor alvo e data limite opcional.', caption: 'Celular: cadastro de um objetivo; criar a meta não registra aporte.', width: 434, height: 943 },
    sections: [
      { id: 'criar', title: 'Criar o objetivo', steps: ['Abra Metas e escolha Criar Nova Meta ou Criar Primeira Meta.', 'Informe um nome e um Valor Alvo maior que zero.', 'Se desejar, informe uma Data Limite.', 'Salve e confira o cartão da meta. Ela começa sem valor aportado; o valor alvo não é retirado automaticamente de uma conta.'] },
      { id: 'aportar', title: 'Registrar dinheiro guardado', steps: ['Escolha Guardar Dinheiro nesta Meta no objetivo desejado.', 'Selecione a Conta de Origem ativa e informe um valor positivo em Valor a Guardar.', 'Confira o saldo da conta e o valor que deseja reservar antes de confirmar.', 'Confirme e confira o valor acumulado da meta e o novo saldo da conta.'], note: 'O aporte reduz o saldo da conta no controle e aumenta o valor acumulado da meta. Não cria uma conta bancária, não aplica dinheiro nem executa transferência no banco.' },
      { id: 'progresso', title: 'Entender o progresso', fields: [
        { name: 'Valor alvo', description: 'Quanto você pretende acumular para esse objetivo.' },
        { name: 'Acumulado', description: 'Valor registrado como reservado na meta. É diferente do saldo disponível na conta de origem.' },
        { name: 'Concluída', description: 'Ao atingir ou ultrapassar o valor alvo por um aporte, a meta é marcada como concluída.' },
        { name: 'Data limite', description: 'Prazo opcional para acompanhar o objetivo. Não agenda transferência nem aporte automático.' },
      ] },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Não encontro Metas no menu', description: 'No modo Apenas Despesas & Rateio, metas e aportes ficam indisponíveis. Você não precisa ativar o modo completo se só quer controlar despesas.' },
        { name: 'A meta é um investimento?', description: 'Ela é um controle de valor reservado. Rendimentos, resgates automáticos ou aplicações em instituições financeiras não são executados por esse cadastro.' },
      ] },
    ],
  },
];
