import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from '../prisma';
import { logAction } from '../auditLogger';
import { requireRole, type AuthRequest } from '../middleware/auth';

const router = Router();
const SALT_ROUNDS = 10;

// Dados de professores (nome, e-mail, login, turmas) são só para o master.
// Vale para todas as rotas deste arquivo, inclusive as de leitura.
router.use(requireRole('master'));

const createTeacherSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  login: z.string().min(1, 'Login é obrigatório'),
  password: z.string().min(6, 'A senha deve ter no mínimo 6 caracteres'),
  subject: z.string().min(1, 'Disciplina é obrigatória'),
  status: z.enum(['active', 'inactive']).default('active'),
  role: z.enum(['teacher', 'master']).optional(),
});

const updateTeacherSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  login: z.string().min(1).optional(),
  password: z.string().min(6).optional().or(z.literal('')),
  subject: z.string().min(1).optional(),
  // 'pending' = cadastro feito pelo próprio professor, aguardando aprovação
  status: z.enum(['active', 'inactive', 'pending']).optional(),
  role: z.enum(['teacher', 'master']).optional(),
});

const TEACHER_STATUSES = ['active', 'inactive', 'pending'];

// O e-mail serve para login e redefinição de senha, então não pode se repetir.
// A comparação ignora maiúsculas; `exceptId` deixa o professor manter o próprio e-mail.
async function emailInUse(email: string, exceptId?: string): Promise<boolean> {
  const other = await prisma.teacher.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { id: true },
  });
  return other !== null;
}

// Violação de campo único no Prisma (aqui, o login)
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

// Listar professores (com paginação, busca e filtro por status)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string || '';
    const status = TEACHER_STATUSES.includes(req.query.status as string) ? (req.query.status as string) : undefined;
    const skip = (page - 1) * limit;

    const where = {
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [teachers, total, pendingCount] = await Promise.all([
      prisma.teacher.findMany({
        where,
        skip,
        take: limit,
        omit: { password: true },
        orderBy: { name: 'asc' },
      }),
      prisma.teacher.count({ where }),
      // Total de cadastros aguardando aprovação, independente do filtro atual
      prisma.teacher.count({ where: { status: 'pending' } }),
    ]);

    res.json({
      data: teachers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        pendingCount,
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
router.post('/', async (req: AuthRequest, res) => {
  try {
    const data = createTeacherSchema.parse(req.body);

    if (await emailInUse(data.email)) {
      return res.status(409).json({ error: 'E-mail já está em uso' });
    }
    
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
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'Login já está em uso' });
    }
    console.error('Erro ao criar professor:', error);
    res.status(500).json({ error: 'Erro ao criar professor' });
  }
});

// Atualizar professor
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const data = updateTeacherSchema.parse(req.body);

    if (data.email && await emailInUse(data.email, req.params.id as string)) {
      return res.status(409).json({ error: 'E-mail já está em uso' });
    }
    
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
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'Login já está em uso' });
    }
    console.error('Erro ao atualizar professor:', error);
    res.status(500).json({ error: 'Erro ao atualizar professor' });
  }
});

export default router;
