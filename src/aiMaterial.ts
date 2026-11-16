import { z } from 'zod';
import { buildStudentContext, redactName, type StudentForAi } from './aiContext';

// Material pronto: a segunda etapa da IA. A primeira sugere a atividade; depois
// que o professor revisa e salva, esta transforma a atividade salva em algo que
// ele pode imprimir e usar.

export const MATERIAL_TYPES = ['worksheet', 'sequence_cards', 'memory_game'] as const;
export type MaterialType = (typeof MATERIAL_TYPES)[number];

// 'none' = atividade que depende de objeto concreto, movimento ou conversa: não há o que imprimir
export const MATERIAL_TYPE_OPTIONS = ['none', ...MATERIAL_TYPES] as const;

export function isMaterialType(value: string): value is MaterialType {
  return (MATERIAL_TYPES as readonly string[]).includes(value);
}

const MATERIAL_LABELS: Record<MaterialType, string> = {
  worksheet: 'ficha de exercícios',
  sequence_cards: 'cartões de sequência',
  memory_game: 'jogo da memória',
};

// ─── Formato pedido ao modelo (JSON Schema) ─────────────────────────────────

const COMMON_PROPERTIES = {
  title: { type: 'string', description: 'Título do material.' },
  instructions: {
    type: 'string',
    description: 'Orientação para o aluno, em uma ou duas frases curtas e literais.',
  },
  teacherNotes: {
    type: 'string',
    description: 'De duas a quatro frases para o professor: como aplicar e como adaptar se o aluno travar.',
  },
};

export const MATERIAL_JSON_SCHEMAS: Record<MaterialType, object> = {
  worksheet: {
    type: 'object',
    properties: {
      ...COMMON_PROPERTIES,
      exercises: {
        type: 'array',
        minItems: 3,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            statement: { type: 'string', description: 'Enunciado curto e direto do exercício.' },
            options: {
              type: 'array',
              maxItems: 4,
              items: { type: 'string' },
              description: 'Alternativas de múltipla escolha. Lista vazia quando a resposta é escrita, desenhada ou oral.',
            },
            answer: { type: 'string', description: 'Resposta esperada, para o gabarito do professor.' },
          },
          required: ['statement', 'options', 'answer'],
        },
      },
    },
    required: ['title', 'instructions', 'exercises', 'teacherNotes'],
  },
  sequence_cards: {
    type: 'object',
    properties: {
      ...COMMON_PROPERTIES,
      cards: {
        type: 'array',
        minItems: 3,
        maxItems: 8,
        description: 'Cartões já na ordem correta da sequência.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Frase curta do cartão (até 12 palavras).' },
            visualHint: { type: 'string', description: 'Descrição simples de um desenho ou pictograma para ilustrar o cartão.' },
          },
          required: ['text', 'visualHint'],
        },
      },
    },
    required: ['title', 'instructions', 'cards', 'teacherNotes'],
  },
  memory_game: {
    type: 'object',
    properties: {
      ...COMMON_PROPERTIES,
      pairs: {
        type: 'array',
        minItems: 4,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            first: { type: 'string', description: 'Primeira carta do par (até 6 palavras).' },
            second: { type: 'string', description: 'Carta que combina com a primeira (até 6 palavras).' },
          },
          required: ['first', 'second'],
        },
      },
    },
    required: ['title', 'instructions', 'pairs', 'teacherNotes'],
  },
};

// ─── Validação do que o modelo devolveu ─────────────────────────────────────
// O provedor não garante limites de tamanho nem campos preenchidos; nada vai
// para o banco sem passar por aqui.

const text = (max: number) => z.string().trim().min(1).max(max);
const commonContent = {
  title: text(200),
  instructions: text(1500),
  teacherNotes: z.string().trim().max(3000),
};

export const MATERIAL_CONTENT_SCHEMAS = {
  worksheet: z.object({
    ...commonContent,
    exercises: z
      .array(
        z.object({
          statement: text(1000),
          options: z.array(text(300)).max(6),
          answer: z.string().trim().max(600),
        }),
      )
      .min(1)
      .max(12),
  }),
  sequence_cards: z.object({
    ...commonContent,
    cards: z.array(z.object({ text: text(400), visualHint: z.string().trim().max(400) })).min(2).max(12),
  }),
  memory_game: z.object({
    ...commonContent,
    pairs: z.array(z.object({ first: text(200), second: text(200) })).min(2).max(12),
  }),
} satisfies Record<MaterialType, z.ZodType>;

// ─── Prompt ─────────────────────────────────────────────────────────────────

const TYPE_RULES: Record<MaterialType, string> = {
  worksheet: `Crie de 4 a 6 exercícios, do mais fácil para o mais difícil.
- Cada exercício tem um enunciado curto (statement).
- Use alternativas (options, de 2 a 4) quando fizer sentido; deixe options vazio quando a resposta for escrita, desenhada ou oral.
- Em answer, escreva a resposta esperada.
- Todo exercício precisa poder ser feito só com papel e lápis.`,
  sequence_cards: `Crie de 4 a 6 cartões que, colocados em ordem, mostram a sequência trabalhada na atividade.
- Devolva os cartões já na ordem correta.
- text: uma frase curta por cartão (até 12 palavras).
- visualHint: descrição simples de um desenho ou pictograma que ilustre o cartão.`,
  memory_game: `Crie de 5 a 6 pares de cartas.
- Em cada par, first e second são as duas cartas que combinam (palavra e significado, pergunta e resposta, conta e resultado, palavra e descrição de figura).
- Textos curtos, de até 6 palavras por carta.
- Não repita cartas e não crie pares ambíguos, em que uma carta combine com duas.`,
};

export interface ActivityForMaterial {
  title: string;
  subject: string;
  description: string;
  difficulty: number;
  visualResources: string[];
  adaptedFor: string[];
  steps: { order: number; description: string }[];
}

// Compara o conteúdo aprovado, ignorando IDs de etapas que podem ser recriados
// pelo formulário. Serve para invalidar material quando a proposta muda.
export function materialSourceKey(activity: ActivityForMaterial & { studentId?: string | null; materialType: string }): string {
  return JSON.stringify({
    title: activity.title,
    subject: activity.subject,
    description: activity.description,
    difficulty: activity.difficulty,
    visualResources: activity.visualResources,
    adaptedFor: activity.adaptedFor,
    studentId: activity.studentId ?? null,
    materialType: activity.materialType,
    steps: [...activity.steps].sort((a, b) => a.order - b.order)
      .map(({ order, description }) => ({ order, description })),
  });
}

// `student` é o aluno vinculado à atividade, ou null quando ela é para a turma.
// O nome do aluno não sai do servidor: é removido do texto da atividade e não
// entra no perfil (ver src/aiContext.ts).
export function buildMaterialPrompt(
  type: MaterialType,
  activity: ActivityForMaterial,
  student: StudentForAi | null,
): string {
  const steps = [...activity.steps]
    .sort((a, b) => a.order - b.order)
    .map((step) => `${step.order}. ${step.description}`)
    .join('\n');

  let activityText = `Título: ${activity.title}
Disciplina: ${activity.subject}
Dificuldade (1 a 5): ${activity.difficulty}
Descrição: ${activity.description || '(sem descrição)'}
Etapas:
${steps || '(sem etapas cadastradas)'}
Recursos visuais previstos: ${activity.visualResources.join(', ') || 'nenhum'}
Adaptada para: ${activity.adaptedFor.join(', ') || 'não informado'}`;

  let studentText = 'Atividade para a turma em geral, sem aluno específico. Mantenha o material inclusivo e acessível.';
  if (student) {
    activityText = redactName(activityText, student.name);
    // Só necessidades e perfil: o histórico de observações não é preciso para montar o material
    studentText = buildStudentContext({ ...student, observations: [], performanceRecords: [] });
  }

  return `Você é um assistente pedagógico especializado em educação inclusiva.
Sua tarefa é produzir o MATERIAL PRONTO de uma atividade que o professor já revisou e aprovou.
Não mude a proposta da atividade: transforme-a em um material que o professor possa imprimir e usar.

=== ATIVIDADE APROVADA PELO PROFESSOR ===
${activityText}
=========================================

=== PERFIL DO ALUNO ===
${studentText}
=======================

TIPO DE MATERIAL: ${MATERIAL_LABELS[type]}
${TYPE_RULES[type]}

REGRAS GERAIS:
- Escreva em português do Brasil, com frases curtas e linguagem literal, sem ironia nem duplo sentido.
- Respeite o nível de dificuldade, as etapas e as adaptações da atividade.
- instructions fala com o aluno; teacherNotes fala com o professor.
- Se o nome do aluno aparecer como [aluno], não invente um nome: escreva "o aluno".
- Devolva somente o objeto JSON pedido.
`;
}
