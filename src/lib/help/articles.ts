import type { HelpArticle } from './types';
import { accountGuides } from './guides/accounts';
import { commitmentGuides } from './guides/commitments';
import { planningGuides } from './guides/planning';
import { reportAccessGuides } from './guides/reports-access';

export type { HelpArticle, HelpSection } from './types';

// Conteúdo editorial versionado junto da aplicação. Cada seção tem uma âncora estável.
export const helpArticles: HelpArticle[] = [
  {
    slug: 'workspaces',
    title: 'Criar e trocar de workspace',
    summary: 'Separe as finanças da casa, de uma viagem ou de outro projeto.',
    category: 'Primeiros passos',
    prerequisites: 'Entre no sistema. Para trocar de workspace, você precisa ter acesso ao ambiente desejado.',
    screen: '/workspaces',
    screenLabel: 'Membros & Acesso',
    related: ['modos-de-operacao', 'dividir-despesas', 'membros-e-permissoes'],
    image: { src: '/help/workspace-desktop.jpg', alt: 'Formulário Criar Novo Workspace no desktop com o nome fictício Casa de exemplo.', caption: 'Desktop: criação de workspace em ambiente local de demonstração.', width: 448, height: 260 },
    mobileImage: { src: '/help/workspace-mobile.jpg', alt: 'Formulário de criação no celular com campo Nome do Workspace e botões Cancelar e Criar Workspace.', caption: 'Celular: o seletor no topo abre o mesmo formulário.', width: 440, height: 790 },
    sections: [
      { id: 'entender', title: 'O que é um workspace?', paragraphs: ['É um ambiente financeiro separado. Suas transações, contas, pessoas de rateio e demais registros pertencem a esse ambiente. Confira o nome no topo antes de cadastrar ou pagar um registro.', 'Sua conta pode começar com um workspace pessoal criado automaticamente no cadastro. Você pode usar esse ambiente ou criar outro para separar seus controles.'] },
      { id: 'criar', title: 'Criar um ambiente', steps: ['Abra o seletor com o nome do workspace no topo da tela.', 'Escolha Novo Workspace.', 'Informe um nome, como “Casa de exemplo”, e escolha Criar Workspace.', 'Confira se o novo nome aparece no topo. O ambiente começa sem os registros dos outros workspaces.'] },
      { id: 'trocar', title: 'Trocar de ambiente', steps: ['Abra novamente o seletor no topo.', 'Selecione o workspace desejado na lista Seus Workspaces.', 'Confira o nome selecionado antes de continuar. A troca não copia nem transfere registros.'] },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Não encontro um workspace', description: 'A lista mostra os ambientes aos quais sua conta tem acesso. Confirme com o responsável se você foi adicionado ao ambiente correto.' },
        { name: 'Pessoa de rateio é um membro?', description: 'Não. Cadastrar apenas um nome para dividir despesas não dá acesso ao workspace.' },
        { name: 'Onde mudar o modo?', description: 'Abra Membros & Acesso. O modo pertence ao workspace selecionado; consulte o guia de modos antes de alterar.' },
      ] },
    ],
  },
  {
    slug: 'modos-de-operacao',
    title: 'Escolher como controlar suas finanças',
    summary: 'Compare o controle patrimonial com o modo de despesas e rateio, sem saldo obrigatório.',
    category: 'Primeiros passos',
    prerequisites: 'Selecione o workspace correto. Para mudar o modo, sua conta precisa ter permissão de administração nesse ambiente.',
    screen: '/workspaces',
    screenLabel: 'Membros & Acesso',
    related: ['workspaces', 'registrar-transacoes', 'dividir-despesas', 'metas'],
    image: { src: '/help/modos-desktop.jpg', alt: 'Comparação dos modos Patrimonial Completo e Apenas Controle de Despesas e Rateio; o segundo está selecionado.', caption: 'Desktop: modo escolhido para o workspace fictício de demonstração.', width: 1216, height: 225 },
    mobileImage: { src: '/help/modos-mobile.jpg', alt: 'Membros e Acesso no celular, com as opções de modo dispostas uma abaixo da outra.', caption: 'Celular: as mesmas opções de modo em Membros & Acesso.', width: 440, height: 790 },
    sections: [
      { id: 'comparar', title: 'Qual modo usar?', fields: [
        { name: 'Modo Patrimonial Completo', description: 'Para acompanhar contas, saldos, receitas, despesas, transferências e metas com aportes. Pagamentos que movimentam saldo exigem uma conta válida do workspace.' },
        { name: 'Apenas Controle de Despesas & Rateio', description: 'Para acompanhar gastos, categorias, pagamentos, cartões e divisão de despesas sem alimentar saldo. Contas não são obrigatórias e novos pagamentos nesse modo não movimentam saldo. Transferências e aportes em metas ficam indisponíveis.' },
      ] },
      { id: 'escolher', title: 'Selecionar o modo', steps: ['Abra Membros & Acesso pelo menu. No celular, use Menu.', 'Encontre Modo de Operação do Workspace.', 'Selecione a opção desejada e confira a indicação do modo ativo.', 'Volte à tela de Transações para cadastrar seus registros.'] },
      { id: 'historico', title: 'O que acontece com o histórico?', paragraphs: ['Alterar o modo não apaga as contas nem os registros anteriores. Pagamentos já realizados conservam seu histórico de efeito sobre saldo; a mudança não recalcula retroativamente todas as movimentações.'], note: 'Não use a troca de modo para corrigir um saldo anterior. Confira os pagamentos e suas contas antes de voltar ao modo completo.' },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Preciso adicionar saldo todo mês?', description: 'No modo de despesas e rateio, não. Você pode registrar despesas e indicar pagamentos sem cadastrar uma conta bancária.' },
        { name: 'Pago ainda existe nesse modo?', description: 'Sim. O acompanhamento de pagamento continua, mesmo sem movimentação de saldo.' },
        { name: 'Por que Metas sumiu do menu?', description: 'Metas com aportes pertencem ao modo patrimonial completo.' },
      ] },
    ],
  },
  {
    slug: 'registrar-transacoes',
    title: 'Registrar uma despesa e acompanhar o pagamento',
    summary: 'Cadastre o gasto, confira datas e diferencie pendência, pagamento parcial e quitação.',
    category: 'Dia a dia',
    prerequisites: 'Selecione um workspace. Para registrar movimentações, sua conta precisa ter permissão de escrita. No modo completo, prepare uma conta válida se for registrar pagamento.',
    screen: '/transactions',
    screenLabel: 'Transações',
    related: ['modos-de-operacao', 'dividir-despesas', 'pagar-faturas', 'relatorios'],
    image: { src: '/help/transacao-desktop.jpg', alt: 'Formulário Nova Despesa no desktop com campos de valor, descrição, categoria, método e rateio.', caption: 'Desktop: Nova Despesa no modo de despesas, com participantes fictícios.', width: 1280, height: 1100 },
    mobileImage: { src: '/help/transacao-mobile.jpg', alt: 'Nova Despesa no celular com valor de R$ 100,00 e descrição Mercado de exemplo.', caption: 'Celular: formulário preenchido com dados fictícios, antes de salvar.', width: 440, height: 956 },
    sections: [
      { id: 'cadastrar', title: 'Cadastrar uma despesa simples', steps: ['Escolha Nova Transação no topo; no celular, use o botão + na barra inferior.', 'Mantenha Despesa selecionada. Preencha o valor e uma descrição clara, como “Mercado de exemplo”.', 'Escolha categoria e método de pagamento, quando aplicáveis.', 'Abra Mais opções (Datas, Conta) para conferir competência, vencimento e conta.', 'Se a despesa já foi paga hoje, marque a opção correspondente. Caso contrário, mantenha-a desmarcada.', 'Escolha Salvar Registro. Confira o registro em Transações e qualquer mensagem de erro.'] },
      { id: 'campos', title: 'Entender os campos', fields: [
        { name: 'Valor', description: 'Informe um valor maior que zero. Use 12,34 ou 12.34 para doze reais e trinta e quatro centavos; confira o valor antes de salvar.' },
        { name: 'Data da Compra / Competência', description: 'Data atribuída ao registro. Não é necessariamente a data em que você pagou.' },
        { name: 'Data de Vencimento', description: 'Quando o compromisso deve ser pago. No cartão, a fatura define o vencimento conforme as datas do cartão.' },
        { name: 'Método e conta', description: 'Método identifica como você paga. Conta identifica de onde sai ou entra saldo no modo completo; um método pode ter uma conta vinculada.' },
        { name: 'Quem pagou?', description: 'Indica o pagador para a divisão da despesa. Esse campo, sozinho, não registra a quitação da transação.' },
      ] },
      { id: 'estados', title: 'Pendente, parcial ou pago?', fields: [
        { name: 'Pendente', description: 'O registro ainda não foi quitado. Cadastrar a despesa e informar um pagador no rateio não bastam para marcá-la como paga.' },
        { name: 'Parcialmente pago', description: 'Há pagamento registrado, mas ainda resta valor a quitar. Confira o valor pago e o saldo restante.' },
        { name: 'Pago', description: 'A obrigação foi quitada no sistema. Isso registra seu controle financeiro; o FinControl não executa pagamentos bancários.' },
        { name: 'Vencido', description: 'Indica uma obrigação em aberto cujo vencimento passou. Confira também o saldo restante e o histórico.' },
      ] },
      { id: 'consultar-periodo', title: 'Consultar gastos e parcelas do período', steps: ['Em Transações, confira o campo Período. O mês atual é selecionado inicialmente; use Todos os meses para consultar registros anteriores e parcelas futuras.', 'Avulsas entram pela competência; compras parceladas aparecem como Parcela 1/3, 2/3 e assim por diante, pelo vencimento de cada parcela. O total da compra não é somado novamente.', 'Combine período, descrição, tipo e status. Se a lista estiver vazia, use Limpar filtros e ver todos os registros antes de cadastrar outra vez.', 'Para gerenciar uma parcela, escolha Ver parcelas e confira a compra em Parcelamentos. Os pagamentos no cartão continuam vinculados à fatura.'] },
      { id: 'editar', title: 'Editar uma transação', steps: ['Em Transações, localize o registro e escolha o ícone de lápis na coluna Ações.', 'Edite descrição, categoria, observações e datas permitidas. Em despesas ainda sem pagamento ou fatura, também é possível ajustar valor, pagador e rateio.', 'Valores e rateios pagos, faturados ou cancelados ficam protegidos. Datas de compras vinculadas ao cartão também são preservadas; editar observações não altera pagamentos.', 'Escolha Salvar alterações e aguarde. Se houver aviso de alteração concorrente, use Atualizar dados e fechar edição e abra novamente antes de salvar.'], note: 'Alterar a competência pode retirar o registro do mês selecionado na listagem. Pagamentos continuam sendo registrados pela ação Pagar.' },
      { id: 'pagar', title: 'Registrar o pagamento depois', steps: ['Abra Transações e localize a despesa.', 'Use a ação de pagamento do registro e informe data e valor. No modo completo, selecione a conta.', 'Para pagamento parcial, informe somente o valor pago agora; ele não pode exceder o restante.', 'Salve e confira o estado e o histórico. Despesas no cartão são quitadas pela fatura correspondente.'], note: 'Um acerto entre participantes não quita automaticamente uma despesa ou fatura. São controles diferentes.' },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Posso registrar uma receita?', description: 'Sim, escolha Receita em Nova Transação. A divisão de despesas não se aplica a receitas.' },
        { name: 'A transação desapareceu?', description: 'Confira o workspace, o período, a busca e os filtros de Transações antes de cadastrá-la novamente.' },
      ] },
    ],
  },
  {
    slug: 'dividir-despesas',
    title: 'Dividir uma despesa e registrar um acerto',
    summary: 'Use nomes de pessoas sem exigir outra conta no sistema e acompanhe quem deve a quem.',
    category: 'Dia a dia',
    prerequisites: 'Selecione o workspace e tenha permissão para registrar despesas. Para dividir, use pelo menos dois participantes: membros ou pessoas cadastradas pelo nome.',
    screen: '/splits',
    screenLabel: 'Divisão de Contas',
    related: ['registrar-transacoes', 'workspaces'],
    image: { src: '/help/divisao-desktop.jpg', alt: 'Divisão fictícia de R$ 100,00: Alex tem R$ 50,00 a receber e Bia tem R$ 50,00 a pagar.', caption: 'Desktop: resultado do exemplo. A despesa ainda está pendente em Transações; o rateio usa o pagador declarado.', width: 1280, height: 1100 },
    mobileImage: { src: '/help/divisao-mobile.jpg', alt: 'Divisão no celular mostrando a sugestão de acerto de R$ 50,00 de Bia para Alex e os cartões do balanço.', caption: 'Celular: sugestão e início do balanço. Role a tela para ver os demais participantes.', width: 440, height: 956 },
    sections: [
      { id: 'pessoas', title: 'Adicionar uma pessoa sem dar acesso', steps: ['Abra Divisão de Contas.', 'Em Pessoas Cadastradas para Rateio, digite um nome fictício para experimentar, como “Alex de exemplo”.', 'Escolha Adicionar. O nome ficará disponível nos próximos rateios deste workspace.', 'Você também pode usar + Nova Pessoa dentro do formulário de despesa.'], note: 'Uma pessoa cadastrada pelo nome não recebe login nem acesso aos dados. Membros & Acesso é um fluxo separado.' },
      { id: 'dividir', title: 'Definir a divisão', steps: ['Abra Nova Transação e escolha Despesa.', 'Informe descrição e valor. Em Divisão de Despesa (Rateio), selecione explicitamente os participantes desejados.', 'Confira Quem pagou?; o pagador é incluído entre os participantes.', 'Escolha a regra de divisão e confira a prévia de valores por participante.', 'Salve o registro e abra Divisão de Contas para conferir o balanço.'] },
      { id: 'regras', title: 'Escolher a regra', fields: [
        { name: 'Sem divisão (100% pagador)', description: 'A despesa fica individual, sem gerar rateio compartilhado.' },
        { name: 'Dividir igualmente', description: 'Reparte o total entre os participantes selecionados, sem incluir automaticamente outros membros do workspace. Centavos restantes são distribuídos para que a soma seja exatamente o total.' },
        { name: '100% de outra pessoa', description: 'O pagador fica sem responsabilidade. Com um outro participante selecionado, ele assume tudo; com vários outros selecionados, o total é dividido igualmente entre eles.' },
        { name: 'Personalizado (definir valores)', description: 'Informe valores por participante, inclusive zero quando necessário. A soma precisa coincidir com o total da despesa.' },
      ] },
      { id: 'repasses-parcelas', title: 'Informar parcelas que a pessoa já lhe repassou', steps: ['Ao cadastrar uma compra parcelada com divisão, confira Parcelas já repassadas por pessoa. O número começa igual às parcelas já pagas da compra e pode ser alterado para cada participante.', 'Informe quantas das primeiras parcelas a pessoa já lhe repassou. Por exemplo, em R$600 divididos 50/50 em 3x, dois repasses correspondem a R$200 e deixam R$100 a acertar.', 'Para uma divisão existente, selecione um mês com parcelas dessa compra e use Ajustar repasses na lista de despesas. Altere a quantidade e salve.', 'Confira o saldo acumulado. Esses repasses reduzem o valor a acertar, mas não alteram o valor da responsabilidade mensal nem registram outro pagamento na conta ou fatura.'], note: 'Não informe novamente valores já lançados no Histórico de Acertos. O ajuste substitui a quantidade anterior; não soma outro repasse. Compras antigas começam com zero repasses informados, mesmo que já tenham parcelas de cartão pagas.' },
      { id: 'mensal', title: 'Conferir a divisão de cada mês', steps: ['Escolha o mês no resumo Divisão do mês.', 'Compras parceladas entram apenas pelo valor das parcelas com vencimento naquele mês. Uma compra de R$600 em 3x, dividida igualmente entre duas pessoas, mostra R$100 de responsabilidade por pessoa em cada mês.', 'Compras avulsas no cartão seguem o vencimento da fatura; demais despesas seguem a competência.', 'Confira a lista de despesas e o número da parcela. O resumo mostra responsabilidades, não comprova pagamento nem desconta acertos de outros períodos.'], note: 'Abra Acertos e saldo acumulado — todos os meses para consultar a dívida completa e os acertos. Esse saldo inclui parcelas futuras e não muda ao trocar o filtro mensal.' },
      { id: 'balanco', title: 'Ler o balanço', paragraphs: ['Exemplo: em uma despesa de R$ 100,00 dividida igualmente entre Alex e Bia, com Alex como pagador, cada um responde por R$ 50,00. Antes de outros registros ou acertos, Alex tem R$ 50,00 a receber e Bia tem R$ 50,00 a pagar.'], fields: [
        { name: 'Total pago nos registros', description: 'Soma atribuída ao pagador indicado nas despesas com rateio. O cálculo inclui despesas pendentes e compras parceladas pelo total da compra; não é um extrato de pagamentos bancários efetivamente realizados.' },
        { name: 'Sua responsabilidade', description: 'Soma das parcelas de responsabilidade atribuídas à pessoa nos rateios.' },
        { name: 'Saldo Líquido', description: 'Compensa o valor atribuído ao pagador, sua responsabilidade e os acertos registrados. Positivo indica a receber; negativo, a pagar. Esse saldo é da divisão, não da conta bancária.' },
      ], note: 'Hoje o rateio considera o pagador declarado em “Quem pagou?” independentemente do estado Pendente/Pago. Confira essa declaração antes de acertar valores; não interprete o rótulo como prova de quitação.' },
      { id: 'compor-saldo', title: 'Entender a composição do saldo acumulado', paragraphs: ['Despesas atribuídas representa o total registrado como responsabilidade de pagamento daquele participante, inclusive valores pendentes e parcelas futuras; não é o valor efetivamente quitado na conta ou fatura.', 'O balanço mostra separadamente a responsabilidade no rateio, os repasses de parcelas enviados/recebidos e os acertos manuais enviados/recebidos. O detalhe por compra informa quantas parcelas foram repassadas e o valor correspondente.', 'Por exemplo, uma responsabilidade acumulada de R$72,00 com R$20,67 já repassados, sem outros acertos, deixa R$51,33 a pagar. A quitação da fatura e o repasse entre pessoas continuam sendo controles separados.'] },
      { id: 'acertar', title: 'Registrar um acerto já realizado', steps: ['Abra Acertos e saldo acumulado — todos os meses e confira os Acertos de Contas Sugeridos. A compensação consolida todos os rateios do workspace, não somente o mês selecionado.', 'Escolha a ação de acerto da sugestão ou Registrar Acerto de Contas.', 'Confira quem paga, quem recebe, a data e o valor. Você pode registrar parte da dívida; não pode exceder o débito consolidado daquele par.', 'Salve e confira o Histórico de Acertos Concluídos e o novo balanço.'], note: 'Registrar o acerto não envia dinheiro, não movimenta o saldo bancário e não marca transações ou faturas como pagas. Registre apenas um acerto que você quer refletir no controle da divisão.' },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Posso arquivar uma pessoa?', description: 'Sim. Arquivar impede seu uso em novos rateios e preserva o histórico. Você pode restaurá-la depois. Excluir é bloqueado quando existe histórico vinculado.' },
        { name: 'Não aparece dívida', description: 'Confira os participantes, o pagador, a regra, o workspace e os acertos anteriores. Dívidas recíprocas podem se compensar.' },
      ] },
    ],
  },
  ...accountGuides,
  ...commitmentGuides,
  ...planningGuides,
  ...reportAccessGuides,
];

export function getHelpArticle(slug: string) {
  return helpArticles.find((article) => article.slug === slug);
}
