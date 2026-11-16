import prisma from './prisma';
import type { AuthRequest } from './middleware/auth';

export function isAdmin(req: AuthRequest): boolean {
  return req.user?.role === 'master' || req.user?.role === 'admin';
}

// As funções abaixo respondem: "este usuário pode vincular um registro a este
// aluno / turma / atividade?". Registro inexistente também devolve false, para
// a rota não revelar se o id existe.

export async function canUseStudent(req: AuthRequest, studentId: string): Promise<boolean> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { class: { select: { teacherId: true } } },
  });
  if (!student) return false;
  return isAdmin(req) || student.class.teacherId === req.user?.id;
}

export async function canUseClass(req: AuthRequest, classId: string): Promise<boolean> {
  const classItem = await prisma.class.findUnique({
    where: { id: classId },
    select: { teacherId: true },
  });
  if (!classItem) return false;
  return isAdmin(req) || classItem.teacherId === req.user?.id;
}

export async function canUseActivity(req: AuthRequest, activityId: string): Promise<boolean> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { teacherId: true },
  });
  if (!activity) return false;
  return isAdmin(req) || activity.teacherId === req.user?.id;
}
