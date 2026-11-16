import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../prisma';
import type { AuthRequest } from '../middleware/auth';
import { isAdmin, canUseStudent } from '../access';
import { MATERIAL_TYPE_OPTIONS, materialSourceKey } from '../aiMaterial';

const router = Router();

// Aceita id, null, ausente ou '' (o front manda '' quando nada foi escolhido).
// Não exige formato UUID porque os dados de exemplo do seed usam ids curtos.
const optionalId = z.string().min(1).max(64).nullable().optional().or(z.literal('').transform(() => null));

const stepSchema = z.object({
  order: z.number().int().min(1).max(500),
  description: z.string().trim().min(1, 'A etapa não pode ficar vazia').max(2000),
});

// Campos sem .default(): no Zod 4, .partial() aplica o valor padrão a campos
// ausentes, e uma edição parcial apagaria dados já gravados.
const activityFields = {
  title: z.string().trim().min(1, 'Título é obrigatório').max(200),
  subject: z.string().trim().min(1, 'Disciplina é obrigatória').max(100),
  description: z.string().max(10000),
  visualResources: z.array(z.string().trim().min(1).max(200)).max(50),
  difficulty: z.number().int().min(1).max(5),
  adaptedFor: z.array(z.string().trim().min(1).max(100)).max(30),
  studentId: optionalId,
  steps: z.array(stepSchema).max(100),
  // Tipo de material que a IA pode gerar para esta atividade ('none' = nenhum)
  materialType: z.enum(MATERIAL_TYPE_OPTIONS),
};

const createActivitySchema = z.object({
  ...activityFields,
  materialType: activityFields.materialType.default('none'),
  description: activityFields.description.default(''),
  visualResources: activityFields.visualResources.default([]),
  adaptedFor: activityFields.adaptedFor.default([]),
  steps: activityFields.steps.optional(),
  teacherId: optionalId, // só é considerado quando quem cria é master/admin
});

const updateActivitySchema = z.object(activityFields).partial();

const STUDENT_DENIED = 'Acesso negado: o aluno não pertence a uma turma sua';

// O que toda resposta de atividade traz junto: etapas em ordem, aluno e material pronto
const ACTIVITY_INCLUDE = {
  steps: { orderBy: { order: 'asc' as const } },
  student: true,
  material: true,
};

// Listar todas as atividades
router.get('/', async (req: AuthRequest, res) => {
  try {
    const whereClause = (req.user?.role === 'master' || req.user?.role === 'admin') ? {} : { teacherId: req.user?.id };

    const activities = await prisma.activity.findMany({
      where: whereClause,
      include: ACTIVITY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    res.json(activities);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar atividades' });
  }
});

// Buscar atividade por ID
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const activity = await prisma.activity.findUnique({
      where: { id: (req.params.id as string) },
      include: ACTIVITY_INCLUDE,
    });
    if (!activity) return res.status(404).json({ error: 'Atividade não encontrada' });

    if ((req.user?.role !== 'master' && req.user?.role !== 'admin') && activity.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta atividade' });
    }

    return res.json(activity);
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao buscar atividade' });
  }
});

// Criar atividade (com steps)
router.post('/', async (req: AuthRequest, res) => {
  try {
    // Só os campos do schema chegam ao banco; qualquer outro campo do corpo é descartado
    const { steps, teacherId: requestedTeacherId, ...activityData } = createActivitySchema.parse(req.body);

    // Professor comum só cria para si; master/admin pode indicar outro professor
    const teacherId = isAdmin(req) && requestedTeacherId ? requestedTeacherId : req.user!.id;

    // O aluno vinculado precisa ser de uma turma de quem está criando
    if (activityData.studentId && !(await canUseStudent(req, activityData.studentId))) {
      return res.status(403).json({ error: STUDENT_DENIED });
    }

    // Prevenção de duplicação (clique duplo): mesma atividade do mesmo professor há menos de 10 segundos
    const tenSecondsAgo = new Date(Date.now() - 10000);
    const existingActivity = await prisma.activity.findFirst({
      where: {
        title: activityData.title,
        subject: activityData.subject,
        teacherId,
        createdAt: { gte: tenSecondsAgo }
      }
    });

    if (existingActivity) {
      return res.status(400).json({ error: 'Uma atividade idêntica foi criada recentemente.' });
    }

    const activity = await prisma.activity.create({
      data: {
        ...activityData,
        teacherId,
        steps: steps ? { create: steps } : undefined,
      },
      include: ACTIVITY_INCLUDE,
    });
    res.status(201).json(activity);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    console.error('Erro ao criar atividade:', error);
    res.status(500).json({ error: 'Erro ao criar atividade' });
  }
});

// Atualizar atividade
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    // Campos ausentes ficam undefined e o Prisma não mexe neles
    const { steps, ...fields } = updateActivitySchema.parse(req.body);
    if (fields.studentId && !(await canUseStudent(req, fields.studentId))) {
      return res.status(403).json({ error: STUDENT_DENIED });
    }

    const activityId = req.params.id as string;
    const result = await prisma.$transaction(async (tx) => {
      // A gravação do material usa o mesmo bloqueio. Assim uma edição não
      // deixa passar um material que terminou de ser gerado simultaneamente.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "activities" WHERE "id" = ${activityId} FOR UPDATE`);
      const existing = await tx.activity.findUnique({ where: { id: activityId }, include: { steps: true } });
      if (!existing) return { status: 404, error: 'Atividade não encontrada' };
      if (!isAdmin(req) && existing.teacherId !== req.user?.id) {
        return { status: 403, error: 'Acesso negado a esta atividade' };
      }

      // Salvar sem mudar conteúdo preserva o material, mesmo que o formulário
      // recrie IDs das etapas. Uma proposta diferente descarta a versão antiga.
      const changed = materialSourceKey(existing) !== materialSourceKey({
        ...existing,
        ...fields,
        steps: steps ?? existing.steps,
      });
      if (steps) await tx.activityStep.deleteMany({ where: { activityId } });
      if (changed) await tx.activityMaterial.deleteMany({ where: { activityId } });
      const activity = await tx.activity.update({
        where: { id: activityId },
        data: { ...fields, steps: steps ? { create: steps } : undefined },
        include: ACTIVITY_INCLUDE,
      });
      return { activity };
    });

    if (result.status !== undefined) return res.status(result.status).json({ error: result.error });
    return res.json(result.activity);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    console.error('Erro ao atualizar atividade:', error);
    res.status(500).json({ error: 'Erro ao atualizar atividade' });
  }
});

// Descartar o material pronto de uma atividade (a atividade continua)
router.delete('/:id/material', async (req: AuthRequest, res) => {
  try {
    const activityId = req.params.id as string;
    const existingActivity = await prisma.activity.findUnique({ where: { id: activityId } });
    if (!existingActivity) return res.status(404).json({ error: 'Atividade não encontrada' });

    if (!isAdmin(req) && existingActivity.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta atividade' });
    }

    await prisma.activityMaterial.deleteMany({ where: { activityId } });
    res.json({ message: 'Material removido' });
  } catch (error) {
    console.error('Erro ao remover material:', error);
    res.status(500).json({ error: 'Erro ao remover material' });
  }
});

// Deletar atividade (steps e material são deletados em cascata)
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const existingActivity = await prisma.activity.findUnique({ where: { id: (req.params.id as string) } });
    if (!existingActivity) return res.status(404).json({ error: 'Atividade não encontrada' });

    if (req.user?.role !== 'master' && req.user?.role !== 'admin' && existingActivity.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta atividade' });
    }

    await prisma.activity.delete({
      where: { id: (req.params.id as string) },
    });
    res.json({ message: 'Atividade deletada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar atividade' });
  }
});

export default router;
