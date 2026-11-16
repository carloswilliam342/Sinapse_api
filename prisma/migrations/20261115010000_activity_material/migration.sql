-- Material pronto das atividades (segunda etapa da IA).
--
-- activities.materialType: tipo de material que pode ser gerado para a
-- atividade ("none" quando não há o que imprimir).
-- activity_materials: o material gerado, um por atividade.
--
-- SQL idempotente, como a migração anterior: roda em banco novo e em banco que
-- já tenha recebido estas mudanças por `prisma db push`.

-- AlterTable
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "materialType" TEXT NOT NULL DEFAULT 'none';

-- CreateTable
CREATE TABLE IF NOT EXISTS "activity_materials" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "activity_materials_activityId_key" ON "activity_materials"("activityId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'activity_materials_activityId_fkey' AND conrelid = '"activity_materials"'::regclass
    ) THEN
        ALTER TABLE "activity_materials" ADD CONSTRAINT "activity_materials_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
