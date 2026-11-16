# Geração de atividades e materiais

## Uso pelo professor

1. Em **Atividades → Nova Atividade**, descreva o tema e a disciplina. Opcionalmente, use **Sugerir atividade (IA)** para preencher a proposta.
2. Revise a proposta, as etapas e o tipo de **Material pronto**. A IA pode recomendar um tipo; o professor pode alterá-lo. Escolha **Nenhum** para atividades que dependem apenas de movimento, conversa ou objetos concretos.
3. Salve a atividade e abra seus detalhes. **Gerar material (IA)** cria uma ficha de exercícios, cartões de sequência ou jogo da memória a partir da versão salva.
4. Revise o conteúdo. **Imprimir material** abre a impressão do navegador, que também permite salvar em PDF. O gabarito e as orientações do professor não aparecem nessa impressão.

Os cartões são de texto, com sugestões de desenhos no caso das sequências; esta versão não gera arquivos de imagem. Gerar novamente substitui o material anterior após confirmação. Excluir o material preserva a atividade. Alterar a proposta, as etapas, o tipo ou o aluno vinculado descarta o material para que seja gerado novamente. Salvar sem mudanças preserva o material.

A instrução das sugestões informa esses limites ao modelo, para que ele não prometa imagens ou traçados pontilhados na ficha pronta. A revisão do professor continua necessária.

## Configuração

| Variável | Uso |
| --- | --- |
| `GEMINI_API_KEY` | Chave do projeto que chama a API do Gemini. |
| `GEMINI_MODEL` | Modelo somente das sugestões; padrão: `gemini-3.5-flash-lite`. |
| `GEMINI_MODEL_MATERIAL` | Modelo somente do material; padrão: `gemini-3.8-flash`. Não herda `GEMINI_MODEL`. |
| `GEMINI_ALLOW_STUDENT_DATA` | Padrão `false`. Só `true` habilita o envio de dados vinculados a alunos, sujeito às condições abaixo. |

O backend usa `@google/genai` e valida o JSON recebido antes de salvá-lo. Cada ação faz uma tentativa no modelo daquela etapa. Falhas não disparam repetição nem troca automática de modelo; um 404 informa indisponibilidade da etapa, e um 429 informa que é preciso aguardar a renovação da cota. Falhas de cota, conteúdo inválido ou indisponibilidade preservam o material anterior. O limite interno por professor é compartilhado pelas duas etapas.

### Cotas e manutenção dos modelos

A divisão reserva as chamadas do 3.8 Flash para os materiais. A cota mostrada pelo usuário em 15/11/2026 era de 5 requisições/minuto, 250 mil tokens de entrada/minuto e 20 requisições/dia para o 3.8. As sugestões usam o 3.5 Flash-Lite e sua própria cota, que pode ser diferente. Regerar um material consome outra chamada; ler ou imprimir o material salvo não chama a IA.

Os limites são compartilhados pelo projeto, e os valores efetivos devem ser consultados no [AI Studio](https://aistudio.google.com/rate-limit). Mantenha o projeto no Free Tier sem conta de faturamento vinculada para usar somente a camada gratuita. O backend não ativa faturamento, não compra créditos e não verifica o Billing Tier da chave.

O Google anunciou o redirecionamento de `gemini-2.5-flash` para `gemini-3.5-flash-lite` em 01/12/2026. O código usa os novos nomes explicitamente, sem o alias variável `gemini-flash-latest`. Referências: [ciclo de vida dos modelos](https://ai.google.dev/gemini-api/docs/deprecations#gemini-2.5-flash-models) e [limites da API](https://ai.google.dev/gemini-api/docs/rate-limits).

Antes de publicar esta versão, confira o histórico do banco com `npx prisma migrate status`. `npx prisma migrate deploy` precisa aplicar as migrações pendentes, inclusive `20261115000000_sync_schema_drift` e `20261115010000_activity_material`. Se o banco nasceu com `db push`, reconcilie o histórico das migrações antes do deploy. Não use reset nem seed no banco de produção.

## Dados dos alunos e plano gratuito

Conferência em **15/11/2026** dos [termos adicionais do Gemini API](https://ai.google.dev/gemini-api/terms#unpaid-services):

- Nos serviços gratuitos, o Google pode usar entradas e respostas para desenvolver produtos e pode submetê-las à revisão humana. Os termos proíbem enviar dados pessoais, confidenciais ou sensíveis nesse plano.
- O acesso à Gemini API é tratado como serviço pago quando ocorre por um projeto Cloud associado a uma conta ativa do Cloud Billing. Nessas condições, os termos dizem que prompts e respostas não são usados para melhorar os produtos e são processados conforme o acordo indicado pelo Google. Isso não elimina os demais requisitos de tratamento de dados da escola.
- A API é destinada a usuários adultos. Na Sinapse, a interface é operada pelo professor; o material pode ser impresso para o aluno, que não interage com a API.

O usuário confirmou o uso do plano gratuito nesta instalação. Portanto, deixe `GEMINI_ALLOW_STUDENT_DATA` ausente ou em `false`. A API recusa sugestões com `studentId` e materiais de atividades vinculadas a um aluno **antes de chamar o provedor**. Não há ativação automática por chave: a variável é uma configuração administrativa, não uma verificação de faturamento do Google.

Para usar dados reais de alunos, primeiro configure um projeto com Cloud Billing ativo e avalie a base, as autorizações e a minimização dos dados da escola; só depois configure `GEMINI_ALLOW_STUDENT_DATA=true`. O filtro de nomes continua ativo, mas não remove apelidos, dados de terceiros nem todo identificador que possa estar nos campos livres. As atividades gerais também exigem revisão do professor para não incluir dados pessoais no texto enviado.

## Testes locais

A suíte usa HTTP, PostgreSQL real e o SDK do Google com transporte interceptado por respostas fictícias. Não chama o Google e não usa a chave real. `TEST_DATABASE_URL` deve apontar para `localhost`/`127.0.0.1`/`::1` e para um banco cujo nome termine em `_test`. A suíte cria e remove apenas seus próprios registros.

Exemplo em PowerShell, com PostgreSQL descartável já disponível:

```powershell
$env:TEST_DATABASE_URL='postgresql://USUARIO:SENHA@127.0.0.1:PORTA/sinapse_material_test'
$env:DATABASE_URL=$env:TEST_DATABASE_URL
npx prisma migrate deploy
npm run build
npm run test:materials
```

Os testes cobrem os três formatos, persistência, substituição sem duplicatas, exclusão em cascata, permissões, validação de saída, falhas do provedor, modelos, proteção dos dados de alunos e edição/exclusão durante a geração.

Em um ambiente Windows com certificado corporativo confiável no sistema, a chamada real pode falhar com `UNABLE_TO_VERIFY_LEAF_SIGNATURE` se o Node não usar esse repositório de certificados. No teste local foi usado Node 24 com os certificados do sistema adicionados às autoridades confiáveis, mantendo a validação TLS. Não desative a verificação de certificados.

Referências técnicas: [migração para o Google GenAI SDK](https://ai.google.dev/gemini-api/docs/migrate) e [configuração de geração](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html).
