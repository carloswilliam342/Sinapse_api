import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../prisma';
import { passwordVersion } from '../middleware/auth';

const SALT_ROUNDS = 10;

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(200),
  login: z.string().trim().min(1, 'Login é obrigatório').max(100),
  password: z.string().min(6, 'A senha deve ter no mínimo 6 caracteres').max(200),
  subject: z.string().trim().min(1, 'Disciplina é obrigatória').max(100),
});

// Exigir strings impede que o corpo traga objetos, que o Prisma leria como filtros
const loginSchema = z.object({
  login: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

// Register
// A conta nasce "pending": só entra no sistema depois que um master aprovar
// (tela Professores). Sem isso, qualquer pessoa na internet viraria professor.
router.post('/register', async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message ?? 'Dados inválidos',
        details: parsed.error.issues,
      });
    }
    const { name, email, login, password, subject } = parsed.data;

    const existingTeacher = await prisma.teacher.findUnique({ where: { login } });
    if (existingTeacher) {
      return res.status(409).json({ error: 'Login já está em uso' });
    }

    // O e-mail serve para login e redefinição de senha, então não pode se repetir
    const existingEmail = await prisma.teacher.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingEmail) {
      return res.status(409).json({ error: 'E-mail já está em uso' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const teacher = await prisma.teacher.create({
      data: { name, email, login, password: hashedPassword, subject, status: 'pending' },
    });

    // O omit global do Prisma já remove o password da resposta
    return res.status(201).json({
      user: teacher,
      message: 'Cadastro recebido. Você poderá entrar depois que um administrador aprovar sua conta.',
    });
  } catch (error) {
    console.error('[Auth] Erro no registro:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(401).json({ error: 'Credenciais inválidas ou usuário inativo' });
    }
    const { login, password } = parsed.data;

    const teacher = await prisma.teacher.findFirst({
      // E-mail sem diferenciar maiúsculas: "Maria@escola" e "maria@escola" são a mesma conta
      where: { OR: [{ login }, { email: { equals: login, mode: 'insensitive' } }] },
      omit: { password: false }, // login precisa do hash para comparar
    });

    const passwordMatch = teacher ? await bcrypt.compare(password, teacher.password) : false;

    // Só quem acertou a senha fica sabendo que a conta aguarda aprovação
    if (teacher && passwordMatch && teacher.status === 'pending') {
      return res.status(403).json({
        error: 'Sua conta ainda aguarda a aprovação de um administrador.',
        code: 'PENDING_APPROVAL',
      });
    }

    if (!teacher || !passwordMatch || teacher.status !== 'active') {
      return res.status(401).json({ error: 'Credenciais inválidas ou usuário inativo' });
    }

    const { password: _, ...teacherWithoutPassword } = teacher;

    const token = jwt.sign(
      // pv: "versão da senha" — trocar a senha invalida este token (ver middleware/auth.ts)
      { id: teacher.id, role: teacher.role, name: teacher.name, pv: passwordVersion(teacher.password) },
      process.env.JWT_SECRET!,
      { expiresIn: 8 * 60 * 60 } // 8 horas em segundos
    );

    return res.json({ user: teacherWithoutPassword, token });
  } catch (error) {
    console.error('[Auth] Erro no login:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
