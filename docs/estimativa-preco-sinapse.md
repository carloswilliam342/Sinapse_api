# Estimativa de Preço — Sistema Sinapse

## Escopo Técnico Identificado

-   **Backend:** Node.js + Express + TypeScript + PostgreSQL + Prisma ORM
-   **Módulos:** Autenticação (JWT + reset de senha por e-mail), Gestão de Professores/Turmas/Alunos, Perfis de Neurodivergência, Atividades Adaptadas, Rotina Semanal com Snapshots, Observações de Aula, Registros de Desempenho, Dashboard Analítico, Logs de Auditoria, Integração com IA (Gemini) para sugestão de atividades personalizadas
-   **Segurança:** Helmet, CORS configurado, Rate Limiting (geral, auth e IA), validação Zod, senhas com bcrypt, roles (master/admin/teacher)
-   **Infraestrutura:** Banco PostgreSQL, envio de e-mails (Resend), API de IA (Gemini)

## Faixa de Preço Sugerida

| Modelo                            | Valor Estimado      | Quando Aplicar                                                     |
| --------------------------------- | ------------------- | ------------------------------------------------------------------ |
| **Licença única (escola pequena)** | R$ 3.000 – R$ 5.000 | Uma escola, até ~20 professores, sem customização                  |
| **Licença única (escola média/grande)** | R$ 6.000 – R$ 10.000 | Múltiplas turmas, volume alto de alunos, treinamento incluso       |
| **Mensalidade (SaaS)**            | R$ 150 – R$ 400/mês | Modelo recorrente, inclui hospedagem, suporte e atualizações       |
| **Desenvolvimento sob medida**    | R$ 12.000 – R$ 20.000 | Se o cliente quiser adaptações exclusivas + código-fonte           |

## Fatores que Justificam o Valor

-   **IA integrada:** diferencial competitivo real; poucas plataformas escolares brasileiras oferecem geração automática de atividades adaptadas por neurodivergência
-   **Especialização em educação inclusiva:** nicho com demanda crescente e pouca oferta de ferramentas dedicadas
-   **Segurança e conformidade:** tratamento adequado de dados sensíveis de menores, logs de auditoria, proteção contra força bruta
-   **Complexidade do domínio:** 10 entidades relacionais, snapshots temporais de rotina, histórico longitudinal de desempenho

## Recomendação Estratégica

Para um TCC que pode virar produto, o modelo mais atraente para escolas é a **mensalidade entre R$ 200–300/mês**, pois reduz a barreira de entrada e gera receita recorrente. Ofereça um período de teste gratuito de 30 dias. Para venda única como projeto acadêmico/profissional, **R$ 5.000–8.000** é uma faixa defensável considerando as horas de desenvolvimento e a especialização embutida.

> ⚠️ Esta estimativa cobre apenas o backend analisado. Se houver frontend (React/Vue), app mobile ou funcionalidades adicionais não visíveis nesta API, o valor deve ser ajustado proporcionalmente.