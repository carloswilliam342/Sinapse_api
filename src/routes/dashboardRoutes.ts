import { Router } from 'express';
import prisma from '../prisma';
import type { AuthRequest } from '../middleware/auth';
import { addDays, todayInAppTz, weekdayOf } from '../dates';

const router = Router();

// GET /api/dashboard/stats
router.get('/stats', async (req: AuthRequest, res) => {
  try {
    // "Hoje" no fuso da escola, não em UTC (ver src/dates.ts)
    const today = todayInAppTz();
    
    const isAdmin = (req.user?.role === 'master' || req.user?.role === 'admin');
    const teacherId = req.user?.id;

    // ─── Totais gerais ────────────────────────────────────────────────────
    const [totalTeachers, totalStudents, totalClasses, totalActivities] = await Promise.all([
      isAdmin ? prisma.teacher.count({ where: { status: 'active' } }) : 1, // Logged in teacher is 1
      prisma.student.count({ where: isAdmin ? undefined : { class: { teacherId } } }),
      prisma.class.count({ where: isAdmin ? undefined : { teacherId } }),
      prisma.activity.count({ where: isAdmin ? undefined : { teacherId } }),
    ]);

    const studentWhere = isAdmin ? {} : { class: { teacherId } };
    const performanceWhere = isAdmin ? {} : { student: { class: { teacherId } } };

    const studentsWithNeeds = await prisma.student.count({
      where: {
        ...studentWhere,
        OR: [
          { needsTea: true },
          { needsTdah: true },
          { otherNeeds: { not: '' } },
        ],
      },
    });

    // ─── Completion stats ─────────────────────────────────────────────────
    const [completed, completedWithHelp, notCompleted] = await Promise.all([
      prisma.performanceRecord.count({ where: { status: 'completed', ...performanceWhere } }),
      prisma.performanceRecord.count({ where: { status: 'completed_with_help', ...performanceWhere } }),
      prisma.performanceRecord.count({ where: { status: 'not_completed', ...performanceWhere } }),
    ]);

    // ─── Atividade semanal (últimos 7 dias) ───────────────────────────────
    const daysOfWeek = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const weeklyActivity: { day: string; atividades: number }[] = [];
    
    for (let i = 6; i >= 0; i--) {
      const dateStr = addDays(today, -i); // YYYY-MM-DD

      const count = await prisma.performanceRecord.count({
        where: { date: dateStr, ...performanceWhere },
      });

      weeklyActivity.push({
        day: daysOfWeek[weekdayOf(dateStr)],
        atividades: count,
      });
    }

    // ─── Top performers (alunos com mais atividades concluídas) ───────────
    const topRaw = await prisma.performanceRecord.groupBy({
      by: ['studentId'],
      where: { status: 'completed', ...performanceWhere },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });

    const topStudents = await Promise.all(
      topRaw.map(async (t) => {
        const student = await prisma.student.findUnique({
          where: { id: t.studentId },
          select: { name: true },
        });
        return { name: student?.name ?? 'Desconhecido', completedCount: t._count.id };
      }),
    );

    // ─── Crescimento mensal de alunos ─────────────────────────────────────
    // Comparação simplificada: total atual vs alunos criados até o mês anterior
    // Como não temos createdAt no Student, usamos contagem total (placeholder)
    const recentGrowth = totalStudents;

    res.json({
      totalTeachers,
      totalStudents,
      totalClasses,
      totalActivities,
      studentsWithNeeds,
      completionStats: { completed, completedWithHelp, notCompleted },
      weeklyActivity,
      topPerformers: topStudents,
      recentGrowth,
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Erro ao carregar estatísticas do dashboard' });
  }
});

export default router;
