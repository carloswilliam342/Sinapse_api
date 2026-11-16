import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '../prisma';
import { sendPasswordResetEmail } from '../mailer';
import { logAction } from '../auditLogger';

const router = Router();
const SALT_ROUNDS = 10;

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Só texto: um objeto no corpo seria lido pelo Prisma como filtro
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }

    // Sempre retorna sucesso para não revelar se o e-mail existe
    const teacher = await prisma.teacher.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' }, status: 'active' },
    });

    if (teacher) {
      // Invalida tokens anteriores não usados
      await prisma.passwordReset.updateMany({
        where: { teacherId: teacher.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      // Cria novo token
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

      await prisma.passwordReset.create({
        data: {
          teacherId: teacher.id,
          token,
          expiresAt,
        },
      });

      // Envia e-mail
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const resetLink = `${frontendUrl}/redefinir-senha?token=${token}`;

      try {
        await sendPasswordResetEmail(teacher.email, resetLink);
      } catch (emailErr) {
        console.error('[PasswordReset] Falha ao enviar e-mail:', emailErr);
        // Não retorna erro ao usuário para manter segurança (a resposta não pode
        // revelar se o e-mail existe). Em troca, a falha fica na Auditoria, onde
        // o master vê que o professor não recebeu o link e pode trocar a senha
        // dele pela tela Professores.
        const reason = emailErr instanceof Error ? emailErr.message : String(emailErr);
        await logAction({
          userId: teacher.id,
          userName: teacher.name,
          action: 'ERROR',
          entity: 'email',
          entityId: teacher.id,
          details: `Falha ao enviar o e-mail de redefinição de senha para "${teacher.name}". O link não chegou. Motivo: ${reason.slice(0, 200)}`,
          ip: req.ip,
        });
      }
    }

    return res.json({
      message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha.',
    });
  } catch (error) {
    console.error('[PasswordReset] Erro:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (typeof token !== 'string' || typeof newPassword !== 'string' || !token || !newPassword) {
      return res.status(400).json({ error: 'Token e nova senha são obrigatórios' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    }

    const resetRecord = await prisma.passwordReset.findUnique({
      where: { token },
    });

    if (!resetRecord) {
      return res.status(400).json({ error: 'Token inválido' });
    }

    if (resetRecord.usedAt) {
      return res.status(400).json({ error: 'Este link já foi utilizado' });
    }

    if (new Date() > resetRecord.expiresAt) {
      return res.status(400).json({ error: 'Este link expirou. Solicite um novo.' });
    }

    // Atualiza a senha
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.teacher.update({
      where: { id: resetRecord.teacherId },
      data: { password: hashedPassword },
    });

    // Marca token como usado
    await prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    });

    return res.json({ message: 'Senha redefinida com sucesso!' });
  } catch (error) {
    console.error('[ResetPassword] Erro:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
