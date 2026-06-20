-- CreateTable
CREATE TABLE "workforce"."skills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(100),
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workforce"."certifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "issuer" VARCHAR(255),
    "expiration_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workforce"."employee_skills" (
    "employee_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "proficiency_level" VARCHAR(50),
    "verified_at" TIMESTAMPTZ(6),

    CONSTRAINT "employee_skills_pkey" PRIMARY KEY ("employee_id","skill_id")
);

-- CreateTable
CREATE TABLE "workforce"."employee_certifications" (
    "employee_id" UUID NOT NULL,
    "certification_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    "issue_date" DATE,
    "expiration_date" DATE,

    CONSTRAINT "employee_certifications_pkey" PRIMARY KEY ("employee_id","certification_id")
);

-- CreateIndex
CREATE INDEX "idx_skills_tenant" ON "workforce"."skills"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_skills_tenant_name" ON "workforce"."skills"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "idx_certifications_tenant" ON "workforce"."certifications"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_certifications_tenant_name" ON "workforce"."certifications"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "idx_employee_skills_employee" ON "workforce"."employee_skills"("employee_id");

-- CreateIndex
CREATE INDEX "idx_employee_skills_skill" ON "workforce"."employee_skills"("skill_id");

-- CreateIndex
CREATE INDEX "idx_employee_certifications_employee" ON "workforce"."employee_certifications"("employee_id");

-- CreateIndex
CREATE INDEX "idx_employee_certifications_certification" ON "workforce"."employee_certifications"("certification_id");

-- CreateIndex
CREATE INDEX "idx_employee_certifications_status" ON "workforce"."employee_certifications"("status");

-- CreateIndex
CREATE INDEX "idx_employee_certifications_expiration" ON "workforce"."employee_certifications"("expiration_date");

-- AddForeignKey
ALTER TABLE "workforce"."employee_skills" ADD CONSTRAINT "employee_skills_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "workforce"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce"."employee_skills" ADD CONSTRAINT "employee_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "workforce"."skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce"."employee_certifications" ADD CONSTRAINT "employee_certifications_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "workforce"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workforce"."employee_certifications" ADD CONSTRAINT "employee_certifications_certification_id_fkey" FOREIGN KEY ("certification_id") REFERENCES "workforce"."certifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
