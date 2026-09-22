import { Router } from 'express';
import { z } from 'zod';
import prisma from '../prisma';
import { logAction } from '../auditLogger';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

const classSchema = z.object({
  name: z.string().min(1, 'Nome da turma é obrigatório'),
  year: z.string().min(1, 'Ano é obrigatório'),
  shift: z.enum(['morning', 'afternoon', 'evening']),
  teacherId: z.string().uuid('ID do professor inválido'),
});

const updateClassSchema = classSchema.partial();

// Listar todas as turmas
router.get('/', async (req: AuthRequest, res) => {
  try {
    const whereClause = (req.user?.role === 'master' || req.user?.role === 'admin') ? {} : { teacherId: req.user?.id };

    const classes = await prisma.class.findMany({
      where: whereClause,
      include: { teacher: true, students: { include: { profile: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(classes);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar turmas' });
  }
});

// Buscar turma por ID
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const classItem = await prisma.class.findUnique({
      where: { id: (req.params.id as string) },
      include: { teacher: true, students: true },
    });
    if (!classItem) return res.status(404).json({ error: 'Turma não encontrada' });

    if ((req.user?.role !== 'master' && req.user?.role !== 'admin') && classItem.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta turma' });
    }

    return res.json(classItem);
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao buscar turma' });
  }
});

// Criar turma
router.post('/', async (req: AuthRequest, res) => {
  try {
    const data = classSchema.parse(req.body);
    
    if ((req.user?.role !== 'master' && req.user?.role !== 'admin')) {
      data.teacherId = req.user!.id;
    }

    const classItem = await prisma.class.create({
      data,
      include: { teacher: true },
    });

    await logAction({
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'CREATE',
      entity: 'class',
      entityId: classItem.id,
      details: `Criou a turma "${classItem.name}"`,
      ip: req.ip,
    });

    res.status(201).json(classItem);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    res.status(500).json({ error: 'Erro ao criar turma' });
  }
});

// Atualizar turma
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const existingClass = await prisma.class.findUnique({ where: { id: (req.params.id as string) } });
    if (!existingClass) return res.status(404).json({ error: 'Turma não encontrada' });

    if ((req.user?.role !== 'master' && req.user?.role !== 'admin') && existingClass.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta turma' });
    }

    const data = updateClassSchema.parse(req.body);
    const classItem = await prisma.class.update({
      where: { id: (req.params.id as string) },
      data,
      include: { teacher: true },
    });

    await logAction({
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'UPDATE',
      entity: 'class',
      entityId: classItem.id,
      details: `Atualizou a turma "${classItem.name}"`,
      ip: req.ip,
    });

    res.json(classItem);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    res.status(500).json({ error: 'Erro ao atualizar turma' });
  }
});

// Deletar turma
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const classItem = await prisma.class.findUnique({ where: { id: (req.params.id as string) } });
    if (!classItem) return res.status(404).json({ error: 'Turma não encontrada' });

    if ((req.user?.role !== 'master' && req.user?.role !== 'admin') && classItem.teacherId !== req.user?.id) {
      return res.status(403).json({ error: 'Acesso negado a esta turma' });
    }

    // Remove dependências em transação — sem isso o delete falha por chave estrangeira
    const classId = req.params.id as string;
    const students = await prisma.student.findMany({ where: { classId }, select: { id: true } });
    const studentIds = students.map(s => s.id);

    await prisma.$transaction([
      prisma.performanceRecord.deleteMany({ where: { studentId: { in: studentIds } } }),
      prisma.lessonObservation.deleteMany({ where: { OR: [{ classId }, { studentId: { in: studentIds } }] } }),
      prisma.studentProfile.deleteMany({ where: { studentId: { in: studentIds } } }),
      prisma.routineItem.deleteMany({ where: { classId } }),
      prisma.activity.updateMany({ where: { studentId: { in: studentIds } }, data: { studentId: null } }),
      prisma.student.deleteMany({ where: { classId } }),
      prisma.class.delete({ where: { id: classId } }),
    ]);

    await logAction({
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'DELETE',
      entity: 'class',
      entityId: (req.params.id as string),
      details: `Deletou a turma "${classItem?.name ?? (req.params.id as string)}"`,
      ip: req.ip,
    });

    res.json({ message: 'Turma deletada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar turma' });
  }
});

export default router;
