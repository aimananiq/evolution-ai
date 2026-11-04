-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "excludeContactListIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "intervalMaxSec" INTEGER,
ADD COLUMN     "intervalMinSec" INTEGER,
ADD COLUMN     "scheduleJson" JSONB;
