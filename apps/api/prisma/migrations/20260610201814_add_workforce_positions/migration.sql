-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "workforce";

-- CreateTable
CREATE TABLE "workforce"."positions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "classification" VARCHAR(100),
    "salary_band" VARCHAR(100),
    "status" VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_positions_tenant" ON "workforce"."positions"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_positions_department" ON "workforce"."positions"("department_id");

-- AddForeignKey
ALTER TABLE "workforce"."positions" ADD CONSTRAINT "positions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "organization"."departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
