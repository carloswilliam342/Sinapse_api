# Sinapse — Educação Inclusiva 🧠 (Backend API)

A **Sinapse** é uma plataforma focada em Educação Inclusiva, facilitando a gestão de alunos neurodivergentes, acompanhamento de atividades, geração de atividades com Inteligência Artificial e estruturação de rotinas pedagógicas.

Este repositório contém a **API REST (Backend)** da aplicação, construída com **Node.js + Express + Prisma + PostgreSQL**. Ele é responsável por gerenciar o banco de dados, tratar regras de negócio e realizar a integração com a **API do Google Gemini** para geração de conteúdo auxiliado por inteligência artificial.

> **Aviso:** Para testar a interface visual, será necessário executar também o Frontend (ver repositório do frontend para instruções).

---

## 🛠 Tecnologias Utilizadas

- **Node.js** & **Express** - Criação do servidor e rotas REST
- **TypeScript** - Tipagem estática para JavaScript
- **Prisma ORM** - Mapeamento das tabelas e consultas ao banco
- **PostgreSQL** - Banco de dados relacional (via Prisma)
- **Google Gemini API** - Integração de IA para sugestões baseadas no perfil dos alunos
- **Bcrypt** - Criptografia de senhas
- **Cors** / **Dotenv** - Tratamentos de requisições de origem cruzada e variáveis de ambiente

---

## ⚙️ Pré-requisitos

Para executar a API localmente, você precisará ter instalado:

- [Node.js](https://nodejs.org/en/download/) (versão 20 ou superior recomendada)
- [PostgreSQL](https://www.postgresql.org/download/) instalado e rodando (ou acesse um banco configurado em nuvem, como Render, Neon, etc.)
- Banco de dados criado no PostgreSQL para a aplicação.

---

## 🚀 Como Executar Localmente

**1. Clone o repositório e acesse a pasta do sinapse-api:**
```bash
git clone https://github.com/SEU_USUARIO/sinapse-api.git
cd sinapse-api
```

**2. Instale as dependências:**
```bash
npm install
```

**3. Configure as Variáveis de Ambiente:**
Crie um arquivo chamado `.env` na pasta raiz e preencha com as suas informações baseando-se no `.env.example`:
```env
# Conexão com o banco de dados (ajuste usuário, senha e nome do banco)
DATABASE_URL="postgresql://USUARIO:SENHA@localhost:5432/NOME_DO_BANCO"

# Porta onde a API vai rodar
PORT=3001

# Chave do Google Gemini (para integração da inteligência artificial)
GEMINI_API_KEY="SUA_CHAVE_AQUI"

# URL de origem para liberar requests vindos do frontend
FRONTEND_URL="http://localhost:5173"
```

**4. Execute as Migrações do Banco de Dados:**
Este comando lerá sua `DATABASE_URL` e criará todas as tabelas necessárias no banco PostgreSQL.
```bash
npx prisma migrate dev
```

**5. (Opcional) Popule o banco com dados de exemplo:**
**Atenção: o seed apaga todas as tabelas antes de inserir os dados de exemplo.** Use só em banco de desenvolvimento.
```bash
npm run seed
```
- Em banco local (`localhost`) roda direto.
- Em banco remoto (Neon, Render etc.) o script se recusa a rodar, a menos que você repita o host do banco em `SEED_CONFIRM`. Com `NODE_ENV=production` ele nunca roda.
- As contas de exemplo (`admin`, `maria.silva`, `joao.santos`) usam a senha de `SEED_PASSWORD`; se ela não for definida, o script gera uma senha e a mostra no terminal ao final.

**6. Inicie o Servidor Localmente:**
```bash
npm run dev
```
Após isso, o terminal mostrará que o servidor está escutando na porta definida (ex: `http://localhost:3001`).

---

## 📦 Scripts Disponíveis (`package.json`)

- `npm run dev`: Inicia o servidor com hot-reload utilizando o `ts-node-dev`. Exclusivo para desenvolvimento.
- `npm run build`: Compila o código nativo `.ts` para código de produção puro `.js` na pasta `dist/`.
- `npm start`: Inicia o projeto baseado nos arquivos buildados do `dist/`. Usado principalmente em produção.
- `npm run seed`: Aciona o script para inserir dados iniciais padrão na camada do Prisma.
- `npm run test:materials`: Verifica geração e persistência de materiais, permissões e falhas da IA em um PostgreSQL local de teste. Exige `TEST_DATABASE_URL`; não usa o banco do `.env`.

## Material pronto com IA

Para abrir uma demonstração local com dados fictícios, Docker e Node 24 disponíveis, execute `node scripts/start-local-preview.cjs` diretamente no terminal. O script usa um PostgreSQL separado no container `sinapse-local-preview`, aplica migrações e preenche somente um banco local vazio. Ele inicia API e frontend em segundo plano, mostra o endereço e a senha inicial de demonstração no terminal e mantém dados no volume `sinapse-preview-pgdata`. O banco do `.env` não é usado. Logs e PIDs ficam em `.local-preview/` (ignorada pelo Git); a chave do Gemini continua vindo do `.env`, e gerar conteúdo usa as cotas reais do projeto.

Na tela **Atividades**, peça uma sugestão ou preencha a proposta manualmente. Escolha **Material pronto** (ficha de exercícios, cartões de sequência ou jogo da memória), revise e salve. Abra os detalhes da atividade para gerar, revisar e imprimir o material. O gabarito e as orientações do professor ficam na tela e não saem na impressão do aluno.

A integração usa o Gemini em duas etapas, com revisão do professor entre elas: **3.5 Flash-Lite nas sugestões** (`GEMINI_MODEL`) e **3.8 Flash no material** (`GEMINI_MODEL_MATERIAL`). Esses são os padrões do código mesmo sem as variáveis. Cada etapa é configurada independentemente e usa o SDK `@google/genai`.

As chamadas não repetem nem trocam de modelo automaticamente. Ao acabar a cota, a API mostra uma mensagem e mantém o material salvo. Para manter o uso gratuito sem cobrança excedente, o projeto da chave precisa permanecer no Free Tier, sem faturamento vinculado; essa configuração é feita na conta do Google, não pelo código.

**Plano gratuito:** mantenha `GEMINI_ALLOW_STUDENT_DATA=false` (também é o padrão quando a variável está ausente). A API bloqueia as duas etapas para atividades vinculadas a alunos, evitando o envio automático de diagnósticos, perfil e histórico. Nas atividades gerais, use apenas conteúdo pedagógico sem dados pessoais nos campos livres. A remoção do nome, sozinha, não torna esses dados anônimos. Consulte [configuração, privacidade e testes](docs/IA.md).

---
*Sinapse — Plataforma de Educação Inclusiva v1.0 (2026).*
