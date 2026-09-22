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

**5. (Opcional) Popule o banco:**
Isso alimentará sua base de dados com informações iniciais, caso você tenha criado seeds.
```bash
npm run seed
```

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

---
*Sinapse — Plataforma de Educação Inclusiva v1.0 (2026).*
