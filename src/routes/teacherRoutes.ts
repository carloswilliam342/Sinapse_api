import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../prisma';
import { logAction } from '../auditLogger';
import { requireRole, type AuthRequest } from '../middleware/auth';

const router = Router();
const SALT_ROUNDS = 10;

const createTeacherSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido'),
  login: z.string().min(1, 'Login é obrigatório'),
  password: z.string().min(6, 'A senha deve ter no mínimo 6 caracteres'),
  subject: z.string().min(1, 'Disciplina é obrigatória'),
  status: z.enum(['active', 'inactive']).default('active'),
  role: z.enum(['teacher', 'master']).optional(),
});

const updateTeacherSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  login: z.string().min(1).optional(),
  password: z.string().min(6).optional().or(z.literal('')),
  subject: z.string().min(1).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  role: z.enum(['teacher', 'master']).optional(),
});

// Listar professores (com paginação e busca)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string || '';
    const skip = (page - 1) * limit;

    const where = search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { email: { contains: search, mode: 'insensitive' as const } },
      ]
    } : {};

    const [teachers, total] = await Promise.all([
      prisma.teacher.findMany({
        where,
        skip,
        take: limit,
        omit: { password: true },
        orderBy: { name: 'asc' },
      }),
      prisma.teacher.count({ where })
    ]);

    res.json({
      data: teachers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar professores' });
  }
});

// Buscar professor por ID
router.get('/:id', async (req, res) => {
  try {
    const teacher = await prisma.teacher.findUnique({
      where: { id: (req.params.id as string) },
      omit: { password: true },
      include: { classes: true },
    });
    if (!teacher) return res.status(404).json({ error: 'Professor não encontrado' });
    return res.json(teacher);
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao buscar professor' });
  }
});

// Criar professor
router.post('/', requireRole('master'), async (req: AuthRequest, res) => {
  try {
    const data = createTeacherSchema.parse(req.body);
    
    // Hash da senha
    const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
    
    const teacher = await prisma.teacher.create({
      data: { ...data, password: hashedPassword },
      omit: { password: true },
    });

    await logAction({
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'CREATE',
      entity: 'teacher',
      entityId: teacher.id,
      details: `Cadastrou o professor "${teacher.name}"`,
      ip: req.ip,
    });

    res.status(201).json(teacher);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    res.status(500).json({ error: 'Erro ao criar professor' });
  }
});

// Atualizar professor
router.put('/:id', requireRole('master'), async (req: AuthRequest, res) => {
  try {
    const data = updateTeacherSchema.parse(req.body);
    
    const updateData: any = { ...data };
    
    // Se a senha foi enviada e não é vazia, faz o hash
    if (data.password && data.password.trim() !== '') {
      updateData.password = await bcrypt.hash(data.password, SALT_ROUNDS);
    } else {
      // Remove a senha do objeto de atualização se for vazia/não definida
      delete updateData.password;
    }

    const teacher = await prisma.teacher.update({
      where: { id: (req.params.id as string) },
      data: updateData,
      omit: { password: true },
    });

    await logAction({
      userId: req.user!.id,
      userName: req.user!.name,
      action: 'UPDATE',
      entity: 'teacher',
      entityId: teacher.id,
      details: `Atualizou o professor "${teacher.name}"`,
      ip: req.ip,
    });

    res.json(teacher);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.issues });
    }
    res.status(500).json({ error: 'Erro ao atualizar professor' });
  }
});

export default router;
