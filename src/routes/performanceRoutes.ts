import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import type { AuthRequest } from '../middleware/auth';
import { isAdmin, canUseActivity, canUseStudent } from '../access';
import { recordId } from '../ids';

const router = Router();

// Campos sem .default(): no Zod 4, .partial() aplica o valor padrão a campos
// ausentes, e uma edição parcial apagaria dados já gravados.
const performanceFields = {
  studentId: recordId('ID do aluno inválido'),
  activityId: recordId('ID da atividade inválido'),
  activityTitle: z.string().min(1, 'Título da atividade é obrigatório'),
  date: z.string().min(1, 'Data é obrigatória'),
  status: z.enum(['completed', 'completed_with_help', 'not_completed']),
  difficultyLevel: z.number().int().min(1).max(5),
  notes: z.string(),
};

const performanceSchema = z.object({
  ...performanceFields,
  notes: performanceFields.notes.default(''),
});

const updatePerformanceSchema = z.object(performanceFields).partial();

const STUDENT_DENIED = 'Acesso negado: o aluno não pertence a sua turma';
const ACTIVITY_DENIED = 'Acesso negado: atividade inexistente ou de outro professor';

// Listar registros de desempenho (com filtros opcionais)
router.get('/', async (req: AuthRequest, res) => {
  try {
    const { studentId, activityId } = req.query;
    const where: any = {};
    if (studentId) where.studentId = studentId as string;
    if (activityId) where.activityId = activityId as string;

    if (!isAdmin(req)) {
      where.student = { class: { teacherId: req.user?.id } };
    }

    const records = await prisma.performanceRecord.findMany({
      where,
      include: { student: true, activity: true },
      orderBy: { date: 'desc' },
    });
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar registros de desempenho' });
  }
});

// Criar registro de desempenho
router.post('/', async (req: AuthRequest, res) => {
  try {
    const data = performanceSchema.parse(req.body);

    if (!(await canUseStudent(req, data.studentId))) {
      return res.status(403).json({ error: STUDENT_DENIED });
    }
    if (!(await canUseActivity(req, data.activityId))) {
      return res.status(403).json({ error: ACTIVITY_DENIED });
    }

    const record = await prisma.performanceRecord.create({
      data,
      include: { student: true, activity: true },
    });
    res.status(201).json(record);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    res.status(500).json({ error: 'Erro ao criar registro de desempenho' });
  }
});

// Atualizar registro de desempenho
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.performanceRecord.findUnique({
      where: { id: req.params.id as string },
      include: { student: { include: { class: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Registro não encontrado' });

    if (!isAdmin(req) && existing.student.class.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a este registro' });
    }

    const data = updatePerformanceSchema.parse(req.body);

    // A checagem acima olhou o aluno atual do registro. Se a edição troca o
    // aluno ou a atividade, o destino também precisa ser de quem edita.
    if (data.studentId && data.studentId !== existing.studentId &&
        !(await canUseStudent(req, data.studentId))) {
      return res.status(403).json({ error: STUDENT_DENIED });
    }
    if (data.activityId && data.activityId !== existing.activityId &&
        !(await canUseActivity(req, data.activityId))) {
      return res.status(403).json({ error: ACTIVITY_DENIED });
    }

    const record = await prisma.performanceRecord.update({
      where: { id: req.params.id as string },
      data,
      include: { student: true, activity: true },
    });
    res.json(record);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    res.status(500).json({ error: 'Erro ao atualizar registro de desempenho' });
  }
});

// Deletar registro de desempenho
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.performanceRecord.findUnique({
      where: { id: req.params.id as string },
      include: { student: { include: { class: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Registro não encontrado' });

    if (!isAdmin(req) && existing.student.class.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a este registro' });
    }

    await prisma.performanceRecord.delete({ where: { id: req.params.id as string } });
    res.json({ message: 'Registro deletado com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar registro de desempenho' });
  }
});

export default router;
