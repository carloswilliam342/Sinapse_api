import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../prisma';

export interface AuthRequest extends Request {
  user?: { id: string; role: string; name: string };
}

interface TokenPayload {
  id?: unknown;
  pv?: unknown;
}

// "Versão da senha": resumo curto do hash guardado no banco. Vai dentro do
// token; quando a senha muda, o hash muda, o resumo deixa de bater e os tokens
// antigos param de valer. Não revela a senha nem o hash.
export function passwordVersion(passwordHash: string): string {
  return crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 16);
}

export async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  let payload: TokenPayload;
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET!);
    if (typeof verified !== 'object' || verified === null) {
      return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
    payload = verified as TokenPayload;
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  if (typeof payload.id !== 'string') {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  try {
    // O token vale 8 horas, mas a conta pode mudar nesse meio-tempo. A cada
    // requisição confere no banco se o professor continua ativo e se a senha
    // ainda é a mesma de quando o token foi emitido.
    const teacher = await prisma.teacher.findUnique({
      where: { id: payload.id },
      select: { id: true, name: true, role: true, status: true, password: true },
    });

    if (!teacher || teacher.status !== 'active') {
      return res.status(401).json({ error: 'Sessão encerrada: conta inativa ou removida' });
    }

    // Tokens emitidos antes desta checagem existir não têm `pv`; continuam
    // valendo até expirar (no máximo 8 horas depois do deploy).
    if (payload.pv !== undefined && payload.pv !== passwordVersion(teacher.password)) {
      return res.status(401).json({ error: 'Sessão encerrada: a senha foi alterada' });
    }

    // Nome e papel vêm do banco, não do token: mudança de papel vale na hora
    req.user = { id: teacher.id, role: teacher.role, name: teacher.name };
    next();
  } catch (error) {
    console.error('[Auth] Erro ao validar sessão:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export function requireRole(role: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Acesso negado: permissão insuficiente' });
    }

    next();
  };
}
