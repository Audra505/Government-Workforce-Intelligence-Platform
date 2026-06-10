-- CreateTable
CREATE TABLE "organization"."departments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_departments_tenant" ON "organization"."departments"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_departments_tenant_code" ON "organization"."departments"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "organization"."departments" ADD CONSTRAINT "departments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "organization"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
