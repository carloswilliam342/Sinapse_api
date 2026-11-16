import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import type { AuthRequest } from '../middleware/auth';
import { isAdmin, canUseActivity } from '../access';

const router = Router();

// Campos sem .default(): no Zod 4, .partial() aplica o valor padrão a campos
// ausentes, e uma edição parcial apagaria dados já gravados.
const observationFields = {
  studentId: z.string().uuid('ID do aluno inválido'),
  classId: z.string().uuid('ID da turma inválido'),
  date: z.string().min(1, 'Data é obrigatória'),
  behavior: z.enum(['excellent', 'good', 'regular', 'difficult']),
  participation: z.enum(['high', 'medium', 'low']),
  completion: z.enum(['completed', 'completed_with_help', 'not_completed']),
  notes: z.string(),
  activityId: z.string().uuid().nullable().optional().or(z.literal('').transform(() => null)),
};

const observationSchema = z.object({
  ...observationFields,
  notes: observationFields.notes.default(''),
});

const updateObservationSchema = z.object(observationFields).partial();

const ACTIVITY_DENIED = 'Acesso negado: atividade inexistente ou de outro professor';

// Listar observações (com filtros opcionais)
router.get('/', async (req: AuthRequest, res) => {
  try {
    const { studentId, classId } = req.query;
    const where: any = {};
    if (studentId) where.studentId = studentId as string;
    if (classId) where.classId = classId as string;

    if (!isAdmin(req)) {
      where.class = { teacherId: req.user?.id };
    }

    const observations = await prisma.lessonObservation.findMany({
      where,
      include: { student: true, class: true, activity: true },
      orderBy: { date: 'desc' },
    });
    res.json(observations);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar observações' });
  }
});

// Criar observação
router.post('/', async (req: AuthRequest, res) => {
  try {
    const data = observationSchema.parse(req.body);

    // Aluno precisa pertencer à turma informada; turma precisa pertencer ao professor
    const student = await prisma.student.findUnique({
      where: { id: data.studentId },
      include: { class: true },
    });
    if (!student || student.classId !== data.classId) {
      return res.status(400).json({ error: 'O aluno não pertence à turma informada' });
    }
    if (!isAdmin(req) && student.class.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado: a turma não pertence a você' });
    }
    if (data.activityId && !(await canUseActivity(req, data.activityId))) {
      return res.status(403).json({ error: ACTIVITY_DENIED });
    }

    const observation = await prisma.lessonObservation.create({
      data,
      include: { student: true, class: true },
    });
    res.status(201).json(observation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    res.status(500).json({ error: 'Erro ao criar observação' });
  }
});

// Atualizar observação
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.lessonObservation.findUnique({
      where: { id: req.params.id as string },
      include: { class: true },
    });
    if (!existing) return res.status(404).json({ error: 'Observação não encontrada' });

    if (!isAdmin(req) && existing.class.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta observação' });
    }

    const data = updateObservationSchema.parse(req.body);

    // A checagem acima olhou a turma atual da observação. Se a edição troca o
    // aluno ou a turma, o destino passa pelas mesmas regras da criação.
    const studentId = data.studentId ?? existing.studentId;
    const classId = data.classId ?? existing.classId;
    if (studentId !== existing.studentId || classId !== existing.classId) {
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: { class: true },
      });
      if (!student || student.classId !== classId) {
        return res.status(400).json({ error: 'O aluno não pertence à turma informada' });
      }
      if (!isAdmin(req) && student.class.teacherId !== req.user?.id) {
        return res.status(403).json({ error: 'Acesso negado: a turma não pertence a você' });
      }
    }
    if (data.activityId && data.activityId !== existing.activityId &&
        !(await canUseActivity(req, data.activityId))) {
      return res.status(403).json({ error: ACTIVITY_DENIED });
    }

    const observation = await prisma.lessonObservation.update({
      where: { id: req.params.id as string },
      data,
      include: { student: true, class: true },
    });
    res.json(observation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    res.status(500).json({ error: 'Erro ao atualizar observação' });
  }
});

// Deletar observação
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const existing = await prisma.lessonObservation.findUnique({
      where: { id: req.params.id as string },
      include: { class: true },
    });
    if (!existing) return res.status(404).json({ error: 'Observação não encontrada' });

    if (!isAdmin(req) && existing.class.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta observação' });
    }

    await prisma.lessonObservation.delete({ where: { id: req.params.id as string } });
    res.json({ message: 'Observação deletada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar observação' });
  }
});

export default router;
