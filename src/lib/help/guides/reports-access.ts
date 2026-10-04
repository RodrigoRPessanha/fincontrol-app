import type { HelpArticle } from '../types';

export const reportAccessGuides: HelpArticle[] = [
  {
    slug: 'relatorios',
    title: 'Ver quanto gastou e exportar um relatório',
    summary: 'Escolha um período, compare valores quitados e pendentes e veja a distribuição dos gastos.',
    category: 'Consultas e acesso',
    prerequisites: 'Tenha acesso ao workspace desejado. Categorias e métodos bem preenchidos tornam a análise mais útil. O relatório está disponível nos dois modos de operação.',
    screen: '/reports', screenLabel: 'Relatórios',
    related: ['registrar-transacoes', 'orcamentos', 'pagar-faturas'],
    image: { src: '/help/relatorios-desktop.jpg', alt: 'Relatórios no desktop com seleção de período, despesas totais, quitadas e pendentes de dados fictícios.', caption: 'Desktop: relatório de demonstração do workspace selecionado.', width: 1280, height: 900 },
    mobileImage: { src: '/help/relatorios-mobile.jpg', alt: 'Relatório no celular com botões Mês, Trimestre, Ano, CSV e JSON e resumo de despesas.', caption: 'Celular: período e resumo; os gráficos e distribuições ficam abaixo.', width: 434, height: 943 },
    sections: [
      { id: 'periodo', title: 'Escolher o período', steps: ['Abra Relatórios e confirme o workspace no topo.', 'Escolha Mês, Trimestre ou Ano.', 'Selecione o mês de referência. Trimestre usa o trimestre civil desse mês; Ano usa o ano da referência.', 'Confira o resumo e role a tela para ver gastos por categoria e método de pagamento.'] },
      { id: 'totais', title: 'Entender total, quitado e pendente', fields: [
        { name: 'Total de Despesas do Período', description: 'Inclui despesas não canceladas pela competência da transação e parcelas não canceladas pelo vencimento no período. Não exige que estejam pagas.' },
        { name: 'Já Quitado', description: 'Parte desses registros que foi paga, incluindo pagamentos parciais. É associada aos itens do período, não necessariamente aos pagamentos realizados nas mesmas datas.' },
        { name: 'Pendente a Pagar', description: 'Soma do restante desses registros. Uma despesa de R$ 100,00 com R$ 30,00 pagos contribui com R$ 100,00 no total, R$ 30,00 quitados e R$ 70,00 pendentes.' },
        { name: 'Categoria e método', description: 'Mostram como o valor total das despesas do período se distribui. Subcategorias são agrupadas na categoria principal; registros sem cadastro correspondente entram em Sem Categoria ou Outro / Sem Método.' },
      ], note: 'Pagamentos parciais de fatura são distribuídos proporcionalmente entre todos os seus itens, com ajuste de centavos, antes do filtro de período. Essa atribuição do relatório não altera pagamentos, saldos ou o estado dos itens em Transações. No CSV, Quitado e Pendente mostram essa atribuição; Status conserva o estado do registro. O relatório não é um extrato bancário por data de pagamento. Também não limita o total à sua responsabilidade no rateio: uma despesa compartilhada entra pelo valor do registro. Para saber quanto cada pessoa deve, use Divisão de Contas.' },
      { id: 'exportar', title: 'Exportar os dados do período', steps: ['Confira período e mês de referência antes de exportar.', 'Escolha CSV para trabalhar com as linhas em uma planilha ou JSON para obter os registros e os dados da referência.', 'Abra o arquivo baixado e confira os registros. A exportação não altera os dados do sistema.'], note: 'A exportação é do relatório selecionado, não um backup completo de todos os workspaces. Os arquivos podem conter informações financeiras suas; escolha onde guardá-los ou compartilhá-los.' },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'Por que difere do saldo da conta?', description: 'Saldo, despesas por competência e pagamentos por data são medidas diferentes. Confira o período, as parcelas, os pagamentos e o modo de operação antes de comparar.' },
        { name: 'Realizado/Previsto muda este relatório?', description: 'Os totais desta tela seguem o período e os registros descritos acima; não são alternados pelo botão Realizado/Previsto do cabeçalho. Esse controle é usado no dashboard.' },
        { name: 'Aparece vazio', description: 'Confira o workspace e o período escolhido. Uma parcela pode estar em outro mês por causa do vencimento, mesmo que a compra tenha ocorrido agora.' },
      ] },
    ],
  },
  {
    slug: 'membros-e-permissoes',
    title: 'Dar acesso ao workspace e escolher permissões',
    summary: 'Diferencie membros com login de pessoas de rateio e compartilhe o ambiente com o papel adequado.',
    category: 'Consultas e acesso',
    prerequisites: 'Para adicionar membros, você precisa ser owner ou admin do workspace. A outra pessoa precisa ter uma conta já cadastrada no FinControl com o e-mail informado.',
    screen: '/workspaces', screenLabel: 'Membros & Acesso',
    related: ['workspaces', 'modos-de-operacao', 'dividir-despesas'],
    image: { src: '/help/permissoes-desktop.jpg', alt: 'Painel de papéis owner, admin, member e viewer no desktop, sem nomes ou e-mails de usuários.', caption: 'Desktop: painel explicativo de permissões; o guia destaca os limites de cada papel.', width: 1280, height: 280 },
    mobileImage: { src: '/help/permissoes-mobile.jpg', alt: 'Painel de papéis e permissões no celular, sem a lista de membros ou endereços de e-mail.', caption: 'Celular: a lista de membros fica em Membros & Acesso; dados pessoais foram excluídos da captura.', width: 440, height: 600 },
    sections: [
      { id: 'escolher', title: 'Precisa dar acesso ou apenas dividir?', fields: [
        { name: 'Membro', description: 'Tem conta e acesso ao workspace, conforme o papel concedido. Pode consultar os dados desse ambiente.' },
        { name: 'Pessoa cadastrada para rateio', description: 'É somente um nome salvo em Divisão de Contas. Não recebe login nem acesso aos seus registros; use essa opção quando quiser apenas dividir gastos.' },
      ] },
      { id: 'adicionar', title: 'Adicionar um usuário existente', steps: ['Selecione o workspace que deseja compartilhar e abra Membros & Acesso.', 'Escolha Convidar Pessoa.', 'Informe o e-mail da conta já cadastrada e escolha admin, member ou viewer, conforme a colaboração necessária.', 'Confirme e confira a lista de Pessoas com acesso e o papel atribuído.', 'A pessoa deve entrar com a própria conta e selecionar o workspace no topo.'], note: 'Apesar do nome “Convidar Pessoa”, esse fluxo atual adiciona um usuário existente. Ele não cria a conta da outra pessoa nem envia um convite de cadastro por e-mail. Se o usuário não for encontrado, confira o e-mail e peça que conclua seu cadastro primeiro.' },
      { id: 'papeis', title: 'Entender os papéis', fields: [
        { name: 'owner — proprietário', description: 'Responsável pelo workspace, com controle administrativo. Criar um novo workspace torna você seu proprietário.' },
        { name: 'admin — administrador', description: 'Pode administrar o ambiente, adicionar membros e alterar o modo de operação, além de trabalhar com os dados financeiros.' },
        { name: 'member — colaborador', description: 'Pode registrar movimentações financeiras. Não administra o acesso de outros usuários nem o modo do workspace; algumas exclusões exigem owner ou admin.' },
        { name: 'viewer — consulta', description: 'Pode consultar dados, relatórios e extratos. Não tem permissão para salvar alterações financeiras.' },
      ], note: 'O papel vale para o workspace selecionado. Um mesmo usuário pode ter papéis diferentes em outros ambientes. Escolha viewer quando a pessoa só precisar consultar.' },
      { id: 'duvidas', title: 'Dúvidas comuns', fields: [
        { name: 'O botão aparece, mas não consigo salvar', description: 'A presença de um botão não garante permissão para a operação. Confira seu papel e a mensagem de erro; solicite ao responsável a ação necessária.' },
        { name: 'O usuário já é membro', description: 'Confira a lista antes de adicioná-lo novamente. Não é necessário duplicar o acesso.' },
        { name: 'Quero alterar ou remover um acesso', description: 'O fluxo atual desta tela oferece inclusão e consulta de membros. Não há ação de alteração de papel ou remoção exposta nela; não cadastre um acesso duplicado como solução.' },
      ] },
    ],
  },
];
