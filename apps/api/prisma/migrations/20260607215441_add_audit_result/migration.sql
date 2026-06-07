-- AlterTable
ALTER TABLE "audit"."audit_events" ADD COLUMN     "result" VARCHAR(50) NOT NULL DEFAULT 'SUCCESS';
