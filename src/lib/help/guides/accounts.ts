import type { HelpArticle } from '../types';

export const accountGuides: HelpArticle[] = [
  {
    slug: 'contas-e-cartoes',
    title: 'Cadastrar contas e cartões',
    summary: 'Prepare suas contas, configure o ciclo do cartão e entenda o papel do saldo.',
    category: 'Contas e pagamentos',
    prerequisites: 'Selecione o workspace correto e tenha permissão de escrita. Contas são necessárias para movimentar saldo no modo completo; no modo de despesas, são opcionais.',
    screen: '/accounts', screenLabel: 'Contas & Cartões',
    related: ['modos-de-operacao', 'pagar-faturas', 'parcelamentos'],
    image: { src: '/help/contas-desktop.jpg', alt: 'Contas e Carteiras no desktop com contas e saldos fictícios de demonstração.', caption: 'Desktop: contas fictícias no modo patrimonial completo.', width: 1280, height: 900 },
    mobileImage: { src: '/help/cartoes-mobile.jpg', alt: 'Cartões de Crédito no celular com limites e datas de fechamento e vencimento fictícios.', caption: 'Celular: role as abas para alternar entre contas, cartões e faturas.', width: 434, height: 943 },
    sections: [
      { id: 'conta', title: 'Cadastrar uma conta', steps: ['Abra Contas & Cartões e selecione Contas & Carteiras.', 'Escolha Nova Conta. Informe nome, tipo e instituição, como “Conta de exemplo”.', 'No modo completo, informe o saldo inicial que deseja usar como ponto de partida. Use vírgula para os centavos, como 500,00.', 'Salve e confira a conta na lista. O cadastro é apenas um registro no FinControl, sem conexão automática com seu banco.'] },
      { id: 'cartao', title: 'Cadastrar um cartão', steps: ['Selecione a aba Cartões de Crédito e escolha Novo Cartão.', 'Informe nome, limite total, dia de fechamento e dia de vencimento. Os últimos quatro dígitos são opcionais; não informe o número completo nem o código de segurança.', 'Escolha Salvar Cartão e confira as datas exibidas.', 'Ao registrar uma despesa, selecione “Cartão — nome do cartão” em Método de Pagamento. Não é necessário cadastrar um método separado. Confira a prévia da fatura e o número de parcelas.'] },
      { id: 'metodos', title: 'Gerenciar métodos de pagamento', steps: ['Abra Configurações → Métodos de Pagamento para cadastrar Pix, dinheiro, boleto ou outra forma de pagamento.', 'Use Editar para mudar o nome. O tipo só pode mudar quando não há histórico nem vínculos com conta ou cartão.', 'Use Desativar para retirar o método de novos lançamentos sem apagar o histórico; métodos inativos continuam na lista e podem ser reativados.', 'Use Excluir e confirme somente para métodos sem transações, compras, pagamentos ou recorrências vinculadas. Se houver uso, o sistema bloqueará a exclusão.'], note: 'Cartões são gerenciados em Contas & Cartões. Desativar um método vinculado não desativa o próprio cartão; cartões ativos continuam disponíveis diretamente.' },
      { id: 'ciclo', title: 'Entender fechamento e vencimento', fields: [
        { name: 'Fechamento', description: 'No cálculo do FinControl, uma compra até o dia de fechamento, inclusive, entra no ciclo daquele mês; depois dele, entra no próximo ciclo.' },
        { name: 'Vencimento', description: 'Se o dia de vencimento for anterior ao de fechamento, o vencimento fica no mês seguinte ao fechamento. Dias inexistentes em um mês são ajustados ao último dia do mês.' },
        { name: 'Limite', description: 'É o limite informado no cadastro, não o saldo bancário. Confira a prévia de fatura no registro da compra e compare com a fatura real do cartão.' },
      ], note: 'A data efetiva de processamento do seu banco pode ser diferente da data da compra. Confira a competência/fatura gerada pelo sistema; o cadastro não sincroniza com a instituição financeira.' },
      { id: 'transferir', title: 'Registrar transferência entre suas contas', steps: ['No modo completo, escolha Transferir entre Contas ou Nova Transferência na aba Transferências.', 'Selecione duas contas ativas e distintas do mesmo workspace.', 'Informe um valor positivo e confirme. O registro reduz uma conta e aumenta a outra pelo mesmo valor.', 'Confira o histórico e os saldos. Isso não envia dinheiro pelo banco; registra uma transferência no seu controle.'] },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Não uso saldo', description: 'Use o modo Apenas Despesas & Rateio. As contas funcionam como identificadores opcionais; pagamentos nesse modo não alteram saldo e transferências ficam desativadas.' },
        { name: 'Cadastrei o cartão, mas não consigo selecioná-lo na despesa', description: 'Confira o workspace e se o cartão está ativo. Cartões ativos aparecem diretamente em Método de Pagamento, nas despesas e recorrências de despesa. Se já houver um método ativo vinculado ao mesmo cartão, ele representa o cartão na lista sem duplicar a opção.' },
        { name: 'A conta não aparece ao pagar', description: 'Confira o workspace e se a conta está ativa. Não use uma conta de outro ambiente para quitar o registro.' },
      ] },
    ],
  },
  {
    slug: 'pagar-faturas',
    title: 'Conferir e pagar uma fatura',
    summary: 'Inspecione compras e parcelas e registre pagamentos totais ou parciais pelo valor restante.',
    category: 'Contas e pagamentos',
    prerequisites: 'Tenha um cartão e despesas vinculadas à fatura no workspace. Para pagar, sua conta precisa ter permissão de escrita; no modo completo, selecione uma conta ativa.',
    screen: '/accounts', screenLabel: 'Contas & Cartões',
    related: ['contas-e-cartoes', 'parcelamentos', 'registrar-transacoes'],
    image: { src: '/help/faturas-desktop.jpg', alt: 'Aba Faturas no desktop mostrando fechamento, vencimento, total, valor pago e ações de faturas fictícias.', caption: 'Desktop: faturas de demonstração. Inspecionar abre a composição da fatura.', width: 1280, height: 900 },
    mobileImage: { src: '/help/faturas-mobile.jpg', alt: 'Inspeção de uma fatura fictícia no celular, com composição e botão Pagar Fatura.', caption: 'Celular: composição da fatura antes de registrar um pagamento.', width: 434, height: 943 },
    sections: [
      { id: 'conferir', title: 'Conferir a composição', steps: ['Abra Contas & Cartões e selecione Faturas. No celular, deslize a faixa de abas se necessário.', 'Localize o cartão e o mês de referência. Confira fechamento, vencimento, Total Fatura e Valor Pago.', 'Escolha Inspecionar para ver as compras avulsas e parcelas vinculadas.', 'Compare os itens com sua fatura real antes de registrar pagamento.'] },
      { id: 'pagar', title: 'Registrar pagamento total ou parcial', steps: ['Escolha Pagar na tabela ou Pagar Fatura na inspeção.', 'Confira o total, o que já foi pago e o restante. Informe o valor pago agora e a data.', 'No modo completo, selecione a conta de origem. No modo de despesas, o pagamento pode ser registrado sem conta.', 'Use o valor restante para quitar tudo ou um valor menor para pagamento parcial. Valores acima do restante são bloqueados.', 'Confirme e aguarde o resultado. Confira Valor Pago, estado da fatura e eventuais mensagens de erro antes de repetir.'], note: 'O FinControl não paga a fatura no banco. Registre aqui o pagamento que deseja refletir no seu controle.' },
      { id: 'estados', title: 'Fatura e itens vinculados', paragraphs: ['A fatura reúne compras avulsas e parcelas do cartão. Esses itens devem ser quitados pela fatura, não por um segundo pagamento individual em Transações ou Parcelamentos.', 'Um pagamento parcial reduz o restante e é distribuído pelo sistema entre os itens vinculados. Não significa que cada item ficará parcialmente pago no mesmo percentual. Confira a composição após salvar.'], fields: [
        { name: 'Pago', description: 'O total da fatura foi quitado no controle. Os itens vinculados são reconciliados com os pagamentos.' },
        { name: 'Parcialmente Pago', description: 'Existe pagamento registrado, mas ainda resta valor da fatura.' },
        { name: 'Fatura Aberta / Fatura Fechada / Vencido', description: 'São indicações do ciclo e do vencimento. Confira também Total Fatura e Valor Pago para saber quanto resta.' },
      ] },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Onde a fatura é criada?', description: 'Ela é associada às despesas de cartão e às parcelas conforme as datas configuradas. Não cadastre uma segunda despesa apenas para representar o pagamento da mesma fatura.' },
        { name: 'Posso escolher a parcela ao pagar parcialmente?', description: 'O pagamento é da fatura; a distribuição entre seus itens é feita pelo sistema. Inspecione o resultado em vez de presumir qual item foi quitado.' },
      ] },
    ],
  },
];
