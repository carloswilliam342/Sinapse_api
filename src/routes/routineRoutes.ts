import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

const routineSchema = z.object({
  classId: z.string().uuid('ID da turma inválido'),
  dayOfWeek: z.number().int().min(0).max(6),
  time: z.string().min(1, 'Horário é obrigatório'),
  title: z.string().min(1, 'Título é obrigatório'),
  activityId: z.string().uuid().nullable().optional().or(z.literal('').transform(() => null)),
  reminder: z.boolean().default(false),
  reminderText: z.string().nullable().optional(),
  color: z.string().min(1, 'Cor é obrigatória'),
});

const updateRoutineSchema = routineSchema.partial();

// Helper: obter segunda-feira da semana de uma data
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getSunday(monday: Date): Date {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

// Listar rotinas (com filtro opcional por turma)
router.get('/', async (req: AuthRequest, res) => {
  try {
    const { classId } = req.query;
    const where: any = {};
    if (classId) where.classId = classId as string;

    if (req.user?.role !== 'master' && req.user?.role !== 'admin') {
      where.class = { teacherId: req.user?.id };
    }

    const routines = await prisma.routineItem.findMany({
      where,
      include: { class: true, activity: true },
      orderBy: [{ dayOfWeek: 'asc' }, { time: 'asc' }],
    });
    res.json(routines);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar rotinas' });
  }
});

// Salvar snapshot da semana atual
router.post('/snapshot', async (req: AuthRequest, res) => {
  try {
    const { classId } = req.body;
    if (!classId) return res.status(400).json({ error: 'classId é obrigatório' });

    // Verificar permissão
    if (req.user?.role !== 'master' && req.user?.role !== 'admin') {
      const classItem = await prisma.class.findUnique({ where: { id: classId } });
      if (!classItem || classItem.teacherId !== req.user?.id) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
    }

    const now = new Date();
    const weekStart = getMonday(now);
    const weekEnd = getSunday(weekStart);

    // Buscar itens da rotina atual
    const items = await prisma.routineItem.findMany({
      where: { classId },
      include: { activity: true },
      orderBy: [{ dayOfWeek: 'asc' }, { time: 'asc' }],
    });

    // Salvar ou atualizar snapshot
    const snapshot = await prisma.routineSnapshot.upsert({
      where: {
        classId_weekStart: { classId, weekStart },
      },
      update: {
        items: items as any,
        weekEnd,
      },
      create: {
        classId,
        weekStart,
        weekEnd,
        items: items as any,
      },
    });

    res.json(snapshot);
  } catch (error) {
    console.error('Erro ao salvar snapshot:', error);
    res.status(500).json({ error: 'Erro ao salvar snapshot da rotina' });
  }
});

// Listar histórico de snapshots
router.get('/snapshots', async (req: AuthRequest, res) => {
  try {
    const { classId } = req.query;
    const where: any = {};
    if (classId) where.classId = classId as string;

    if (req.user?.role !== 'master' && req.user?.role !== 'admin') {
      where.class = { teacherId: req.user?.id };
    }

    const snapshots = await prisma.routineSnapshot.findMany({
      where,
      include: { class: true },
      orderBy: { weekStart: 'desc' },
    });

    res.json(snapshots);
  } catch (error) {
    console.error('Erro ao buscar snapshots:', error);
    res.status(500).json({ error: 'Erro ao buscar histórico de rotinas' });
  }
});

// Criar rotina
router.post('/', async (req: AuthRequest, res) => {
  try {
    const data = routineSchema.parse(req.body);

    if (req.user?.role !== 'master' && req.user?.role !== 'admin') {
      const classItem = await prisma.class.findUnique({ where: { id: data.classId } });
      if (!classItem || classItem.teacherId !== req.user?.id) {
        return res.status(403).json({ error: 'Acesso negado: a turma não pertence a você' });
      }
    }

    const routine = await prisma.routineItem.create({
      data,
      include: { class: true, activity: true },
    });
    res.status(201).json(routine);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    res.status(500).json({ error: 'Erro ao criar rotina' });
  }
});

// Atualizar rotina
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const data = updateRoutineSchema.parse(req.body);

    const existingRoutine = await prisma.routineItem.findUnique({
      where: { id: (req.params.id as string) },
      include: { class: true },
    });

    if (!existingRoutine) return res.status(404).json({ error: 'Rotina não encontrada' });

    if (req.user?.role !== 'master' && req.user?.role !== 'admin' && existingRoutine.class.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado: a turma não pertence a você' });
    }

    const routine = await prisma.routineItem.update({
      where: { id: (req.params.id as string) },
      data,
      include: { class: true, activity: true },
    });
    res.json(routine);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    res.status(500).json({ error: 'Erro ao atualizar rotina' });
  }
});

// Deletar rotina
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const existingRoutine = await prisma.routineItem.findUnique({
      where: { id: (req.params.id as string) },
      include: { class: true },
    });

    if (!existingRoutine) return res.status(404).json({ error: 'Rotina não encontrada' });

    if (req.user?.role !== 'master' && req.user?.role !== 'admin' && existingRoutine.class.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado: a turma não pertence a você' });
    }

    await prisma.routineItem.delete({
      where: { id: (req.params.id as string) },
    });
    res.json({ message: 'Rotina deletada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar rotina' });
  }
});

export default router;
