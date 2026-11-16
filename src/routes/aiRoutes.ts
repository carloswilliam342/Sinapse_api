import { Router, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../prisma';
import type { AuthRequest } from '../middleware/auth';
import { isAdmin } from '../access';
import { buildStudentContext, redactName, restoreStudentWording, STUDENT_PLACEHOLDER } from '../aiContext';
import { AiError, AI_ERROR_STATUS, assertStudentDataAllowed, generateJson } from '../aiProvider';
import {
  MATERIAL_CONTENT_SCHEMAS,
  MATERIAL_JSON_SCHEMAS,
  MATERIAL_TYPE_OPTIONS,
  buildMaterialPrompt,
  isMaterialType,
  materialSourceKey,
} from '../aiMaterial';

const router = Router();

// A IA trabalha em duas etapas, com o professor no meio:
//   1. POST /suggest-activity          → sugere a atividade e preenche o formulário
//   (o professor revisa, ajusta e salva)
//   2. POST /activities/:id/material   → transforma a atividade SALVA em material pronto
// A etapa 2 lê a atividade do banco: o que vale é o que o professor aprovou,
// não a sugestão original.

// Falha do provedor de IA vira uma resposta com a mensagem certa; devolve false
// quando o erro não é da IA, para o chamador tratar como erro interno.
function sendAiError(res: Response, error: unknown): boolean {
  if (!(error instanceof AiError)) return false;
  res.status(AI_ERROR_STATUS[error.kind]).json({ error: error.message });
  return true;
}

// ─── Etapa 1: sugestão de atividade ─────────────────────────────────────────

// Limites de tamanho: o texto do professor vai inteiro para o prompt, e prompt maior custa mais
const suggestSchema = z.object({
  studentId: z.string().min(1).max(64).nullable().optional().or(z.literal('').transform(() => null)),
  subject: z.string().trim().min(1).max(100),
  theme: z.string().trim().min(1).max(5000),
  difficultyLevel: z.number().int().min(1).max(5).nullable().optional(),
});

// Formato pedido ao modelo
const SUGGESTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Um título criativo e adaptado para a atividade.' },
    description: {
      type: 'string',
      description: 'A descrição completa do que se trata a atividade e seus objetivos pedagógicos adaptados para esse aluno específico.',
    },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Passo a passo sequencial da atividade, quebrado em partes gerenciáveis e acessíveis.',
    },
    visualResources: {
      type: 'array',
      items: { type: 'string' },
      description: 'Lista de recursos visuais sugeridos ou materiais concretos de apoio para ajudar esse aluno.',
    },
    adaptedFor: {
      type: 'array',
      items: { type: 'string' },
      description: "Lista de necessidades para as quais a atividade foi adaptada, baseada no aluno. Opções válidas: 'TEA', 'TDAH', 'Dislexia', 'Discalculia', 'Deficiência Intelectual'. Retorne apenas as aplicáveis correspondentes ao perfil do aluno.",
    },
    materialType: {
      type: 'string',
      enum: [...MATERIAL_TYPE_OPTIONS],
      description: "Tipo de material imprimível que pode ser gerado depois para esta atividade: 'worksheet' (ficha de exercícios de papel e lápis), 'sequence_cards' (cartões para colocar uma sequência em ordem), 'memory_game' (pares de cartas que combinam). Use 'none' quando a atividade depender de objetos concretos, movimento, conversa ou materiais que não podem ser impressos.",
    },
  },
  required: ['title', 'description', 'steps', 'visualResources', 'adaptedFor', 'materialType'],
};

// Conferência do que o modelo devolveu. Um tipo de material fora da lista vira
// 'none' em vez de derrubar a sugestão inteira.
const suggestionResultSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  steps: z.array(z.string().trim().min(1).max(2000)).max(100),
  visualResources: z.array(z.string().trim().min(1).max(200)).max(50),
  adaptedFor: z.array(z.string().trim().min(1).max(100)).max(30),
  materialType: z.enum(MATERIAL_TYPE_OPTIONS).catch('none'),
});

router.post('/suggest-activity', async (req: AuthRequest, res) => {
  try {
    const parsed = suggestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Disciplina (subject) e tema (theme) são obrigatórios.',
        details: parsed.error.issues,
      });
    }
    const { studentId, difficultyLevel } = parsed.data;
    let subject = parsed.data.subject;
    let theme = parsed.data.theme;

    let contextStr = '';

    if (studentId) {
      // 1. Buscar o aluno com todos os dados relevantes de histórico
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: {
          class: true,
          profile: true,
          observations: {
            orderBy: { date: 'desc' },
            take: 5 // Pegar as 5 últimas observações para contexto
          },
          performanceRecords: {
            orderBy: { date: 'desc' },
            take: 5 // Pegar o desempenho das 5 últimas atividades
          }
        }
      });

      if (!student) {
        return res.status(404).json({ error: 'Aluno não encontrado.' });
      }

      // Professor só pode gerar sugestões para alunos das próprias turmas
      if (!isAdmin(req) && student.class.teacherId !== req.user?.id) {
        return res.status(403).json({ error: 'Acesso negado: o aluno não pertence a sua turma.' });
      }

      assertStudentDataAllowed();

      // 2. Montar o contexto do aluno SEM o nome dele (ver src/aiContext.ts).
      //    O tema digitado pelo professor também pode citar o aluno pelo nome.
      contextStr = buildStudentContext(student);
      theme = redactName(theme, student.name);
      subject = redactName(subject, student.name);
    } else {
      contextStr = `Atividade genérica (não direcionada a um aluno específico).\nCrie uma atividade inclusiva e acessível para a turma de forma geral, com foco na aprendizagem neurodivergente se pertinente ao tema.`;
    }

    // 3. Montar o Prompt Especializado
    const prompt = `Você é um assistente pedagógico especializado em educação inclusiva.
Sua tarefa é criar uma sugestão detalhada de atividade escolar.

O professor está planejando uma atividade da disciplina "${subject}" focada no conteúdo/tema "${theme}"${studentId ? ' para o aluno descrito abaixo.' : '.'}
${difficultyLevel ? `A dificuldade desejada pelo professor (1 a 5) é: ${difficultyLevel}.` : ''}

=== PERFIL E HISTÓRICO DO ALUNO ===
${contextStr}
===================================

INSTRUÇÕES PEDAGÓGICAS PARA O MODELO:
- Adapte a linguagem, o tempo estimado e a complexidade para se adequarem ao nível de desempenho, necessidades (TEA, TDAH, etc.) e dificuldades do aluno.
- Se o aluno não tiver um lado forte de participação contínua ou tiver perfil de desatenção, sugira passos muito curtos ("micro-passos") com recompensas/pausas ("tokens").
- Caso haja histórico de não conclusão ou resistência a certos estímulos detalhado no histórico, evite-os ativamente.
- Proponha recursos visuais eficientes ("timers" visuais, pictogramas, blocos lógicos, pranchas de comunicação) se adequarem ao perfil analisado.
- O nome do aluno foi omitido de propósito e aparece como ${STUDENT_PLACEHOLDER}. Não invente um nome; no texto da atividade, escreva "o aluno".
- Em "materialType", indique se esta atividade pode virar um material imprimível e de qual tipo; use "none" quando não puder.
- O material imprimível do sistema é textual: worksheet contém enunciados, alternativas e espaço para resposta; sequence_cards contém cartões de texto e sugestões de desenhos; memory_game contém pares de textos. O sistema não gera imagens, pictogramas nem letras ou números pontilhados. Não prometa esses elementos na ficha pronta. Se forem indispensáveis à proposta, use "none" e explique o que o professor precisa preparar; quando possível, proponha exercícios textuais ou desenhos feitos pelo próprio aluno.
- Você DEVE retornar EXCLUSIVAMENTE UM OBJETO JSON, contendo "title", "description", "steps" (array), "visualResources" (array), "adaptedFor" (array) e "materialType".
`;

    // 4. Chamar o provedor e conferir o que voltou
    const raw = await generateJson('suggestion', prompt, SUGGESTION_JSON_SCHEMA);
    const suggestion = suggestionResultSchema.safeParse(raw);
    if (!suggestion.success) {
      console.error('[IA] Sugestão fora do formato:', suggestion.error.issues);
      return res.status(502).json({ error: 'A IA devolveu uma sugestão incompleta. Tente de novo.' });
    }

    // Se o modelo repetir o marcador na resposta, o professor vê "o aluno"
    return res.json(restoreStudentWording(suggestion.data));
  } catch (error) {
    if (sendAiError(res, error)) return;
    console.error('Erro ao gerar sugestão de atividade:', error);
    return res.status(500).json({ error: 'Erro ao gerar sugestão de atividade utilizando a IA.' });
  }
});

// ─── Etapa 2: material pronto a partir da atividade salva ───────────────────

router.post('/activities/:id/material', async (req: AuthRequest, res) => {
  try {
    const activityId = req.params.id as string;

    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      include: {
        steps: true,
        student: { include: { profile: true } },
      },
    });
    if (!activity) return res.status(404).json({ error: 'Atividade não encontrada' });

    if (!isAdmin(req) && activity.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta atividade' });
    }

    if (!isMaterialType(activity.materialType)) {
      return res.status(400).json({
        error: 'Esta atividade está marcada como sem material para gerar. Edite a atividade e escolha um tipo de material.',
      });
    }
    const type = activity.materialType;

    if (activity.studentId) assertStudentDataAllowed();

    // Do aluno vão só necessidades e perfil, sem o nome (ver src/aiMaterial.ts)
    const student = activity.student
      ? { ...activity.student, observations: [], performanceRecords: [] }
      : null;

    const prompt = buildMaterialPrompt(type, activity, student);
    const raw = await generateJson('material', prompt, MATERIAL_JSON_SCHEMAS[type]);

    const content = MATERIAL_CONTENT_SCHEMAS[type].safeParse(raw);
    if (!content.success) {
      console.error('[IA] Material fora do formato:', content.error.issues);
      return res.status(502).json({ error: 'A IA devolveu um material incompleto. Tente gerar de novo.' });
    }

    const data = restoreStudentWording(content.data) as Prisma.InputJsonValue;

    // A chamada pode demorar. Não anexar uma resposta antiga se a atividade
    // tiver sido editada, apagada ou transferida enquanto a IA respondia.
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "activities" WHERE "id" = ${activityId} FOR UPDATE`);
      const current = await tx.activity.findUnique({
        where: { id: activityId },
        include: { steps: true, student: { include: { profile: true } } },
      });
      if (!current) return { status: 404, error: 'Atividade não encontrada' };

      const user = await tx.teacher.findUnique({
        where: { id: req.user!.id },
        select: { role: true, status: true },
      });
      if (!user || user.status !== 'active') return { status: 401, error: 'Sessão inválida' };
      if (user.role !== 'master' && user.role !== 'admin' && current.teacherId !== req.user!.id) {
        return { status: 403, error: 'Acesso negado a esta atividade' };
      }

      const currentStudent = current.student
        ? { ...current.student, observations: [], performanceRecords: [] }
        : null;
      if (materialSourceKey(current) !== materialSourceKey(activity) ||
          buildMaterialPrompt(type, current, currentStudent) !== prompt) {
        return { status: 409, error: 'A atividade mudou durante a geração. Confira a versão atual e gere o material de novo.' };
      }

      // Um material por atividade: gerar de novo substitui o anterior.
      const material = await tx.activityMaterial.upsert({
        where: { activityId },
        update: { type, content: data },
        create: { activityId, type, content: data },
      });
      return { material };
    });

    if (result.status !== undefined) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result.material);
  } catch (error) {
    if (sendAiError(res, error)) return;
    if (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2002')) {
      return res.status(409).json({ error: 'A atividade mudou durante a geração. Confira a versão atual e gere o material de novo.' });
    }
    console.error('Erro ao gerar material da atividade:', error);
    return res.status(500).json({ error: 'Erro ao gerar o material da atividade.' });
  }
});

export default router;
