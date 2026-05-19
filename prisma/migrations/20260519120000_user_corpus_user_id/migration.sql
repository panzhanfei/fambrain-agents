-- AlterTable
ALTER TABLE "User" ADD COLUMN "corpusUserId" TEXT;

-- 已有家庭成员：默认指向最早创建的 ACTIVE ADMIN（主角语料）
UPDATE "User"
SET "corpusUserId" = (
  SELECT "id" FROM "User" AS admin
  WHERE admin."role" = 'ADMIN'
  ORDER BY admin."createdAt" ASC
  LIMIT 1
)
WHERE "corpusUserId" IS NULL
  AND "role" != 'ADMIN'
  AND EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN');
