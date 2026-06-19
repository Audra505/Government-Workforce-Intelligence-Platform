-- CreateTable
CREATE TABLE "workforce"."employees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "employee_number" VARCHAR(100),
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255),
    "employment_status" VARCHAR(50) NOT NULL DEFAULT 'PENDING_ONBOARDING',
    "hire_date" DATE,
    "termination_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_employees_tenant" ON "workforce"."employees"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_employee_number_tenant" ON "workforce"."employees"("tenant_id", "employee_number");

-- AddForeignKey
ALTER TABLE "workforce"."employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "organization"."departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
