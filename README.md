# FinControl - App de Controle Financeiro Pessoal e Compartilhado

Aplicativo completo e moderno de **controle financeiro pessoal e compartilhado**, construído com **Next.js 16 (Turbopack, App Router), React 19, TypeScript, Tailwind CSS e Supabase (PostgreSQL, RLS, RPCs e Auth)** com suporte a operação local offline-first resiliente.

---

## 🚀 Funcionalidades Principais

### 1. Workspaces Financeiros & Permissões (Supabase RLS)
* **Ambientes Independentes**: Permite alternar entre múltiplos ambientes (ex: *Minhas Finanças* (pessoal) e *Casa & Família* (compartilhado)).
* **Papéis de Acesso**: Suporte a `owner`, `admin`, `member` e `viewer`.
* **Segurança**: Políticas completas de Row Level Security (RLS) no PostgreSQL garantem isolamento rigoroso dos dados.

### 2. Motor Financeiro de Alta Precisão
* **Competência vs. Vencimento vs. Pagamento**: Separação clara de quando a obrigação ocorreu, quando vence e quando foi efetivamente liquidada.
* **Pagamentos Parciais e Múltiplos**: Suporte a múltiplos pagamentos para a mesma obrigação com recálculo automático de status (`pending`, `partially_paid`, `paid`).
* **Compras Parceladas Atômicas**: Divisão precisa de $N$ parcelas sem perda de centavos (a 1ª parcela absorve o arredondamento).
* **Faturas de Cartão Inteligentes**: Cálculo automático do mês de fatura baseado no dia de fechamento e vencimento do cartão.
* **Transferências Neutras**: Movimentação entre contas bancárias sem distorcer o fluxo de receitas/despesas ou patrimônio líquido.

### 3. Planejamento & Comprometimento Futuro
* **Horizonte de 3, 6 e 12 meses**: Projeção mês a mês de parcelas contratadas, custos fixos recorrentes e contas pendentes em relação à renda prevista.
* **Taxa de Comprometimento**: Indicador percentual de quanto da renda futura já está contratada.

### 4. Orçamentos Mensais & Metas Financeiras
* **Orçamentos por Categoria**: Teto de gastos mensal com barras de progresso e alertas de estouro.
* **Metas Financeiras**: Acompanhamento de objetivos (ex: Reserva de Emergência) com aporte direto debitando de conta bancária.

### 5. Experiência de Usuário (UX)
* **Adição Rápida com Divulgação Progressiva**: Formulário minimalista de 4 campos essenciais + botão *"Mais opções"* para detalhes avançados (datas, contas e métodos).
* **Perspectiva Dual no Dashboard**: Alternância instantânea entre visão **Realizada (Caixa)** e **Prevista (Competência do Mês)**.
* **Responsividade Total**: Layout otimizado para desktop com sidebar retrátil e mobile com navegação por barra inferior e gaveta deslizante.
* **Exportação**: Suporte a exportação de dados em CSV e JSON.

---

## 🛠️ Como Executar Localmente

### 1. Instalar Dependências
```bash
npm install
```

### 2. Rodar em Modo de Desenvolvimento
```bash
npm run dev
```
Abra [http://localhost:3000](http://localhost:3000) no navegador. O app já vem com dados realistas pré-carregados para demonstração imediata!

### 3. Build de Produção
```bash
npm run build
npm run start
```

---

## 🗄️ Configuração do Banco de Dados Supabase (V38)

1. Crie ou vincule seu projeto no [Supabase](https://supabase.com):
```bash
npx supabase link --project-ref seu-project-ref
```

2. Aplique as migrações (001 a 028) de forma atômica via Supabase CLI:
```bash
npx supabase db push --linked
```

3. Crie um arquivo `.env.local` na raiz do projeto (consulte `.env.example`):
```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sua-chave-publica-aqui
NEXT_PUBLIC_DATA_MODE=supabase
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

4. Para instruções detalhadas de CI/CD (GitHub Actions), ambientes Staging/Produção e deploy na Vercel, consulte o [DEPLOYMENT.md](./DEPLOYMENT.md).
