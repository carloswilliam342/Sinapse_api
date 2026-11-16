-- Sincroniza as migrações com o schema.
--
-- As duas mudanças abaixo (coluna activities.teacherId e tabela
-- routine_snapshots) foram aplicadas ao banco com `prisma db push` e nunca
-- viraram migração. Um banco criado só pelas migrações ficava sem elas.
--
-- O SQL é idempotente de propósito: cria o que falta e não faz nada onde a
-- coluna, a tabela, o índice ou a chave já existem. Assim a mesma migração
-- serve para um banco novo e para o banco que já recebeu o db push.

-- AlterTable
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "teacherId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "routine_snapshots" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routine_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "routine_snapshots_classId_weekStart_key" ON "routine_snapshots"("classId", "weekStart");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'activities_teacherId_fkey' AND conrelid = '"activities"'::regclass
    ) THEN
        ALTER TABLE "activities" ADD CONSTRAINT "activities_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'routine_snapshots_classId_fkey' AND conrelid = '"routine_snapshots"'::regclass
    ) THEN
        ALTER TABLE "routine_snapshots" ADD CONSTRAINT "routine_snapshots_classId_fkey" FOREIGN KEY ("classId") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
