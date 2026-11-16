import prisma from './prisma';

interface LogActionParams {
  userId: string;
  userName: string;
  // ERROR = falha de sistema que o master precisa ver (ex.: e-mail não enviado)
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'ERROR';
  entity: string;
  entityId?: string;
  details: string;
  ip?: string;
}

export async function logAction(params: LogActionParams) {
  try {
    await prisma.systemLog.create({
      data: {
        userId: params.userId,
        userName: params.userName,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId ?? null,
        details: params.details,
        ip: params.ip ?? null,
      },
    });
  } catch (err) {
    // Nunca interrompe o fluxo principal por falha de log
    console.error('[AuditLog] Falha ao gravar log:', err);
  }
}
