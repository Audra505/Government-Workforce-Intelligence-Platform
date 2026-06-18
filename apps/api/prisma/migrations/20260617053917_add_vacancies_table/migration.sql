-- CreateTable
CREATE TABLE "workforce"."vacancies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "priority" VARCHAR(50),
    "reason" VARCHAR(100),
    "status" VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    "expected_fill_date" DATE,
    "filled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "vacancies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_vacancies_tenant" ON "workforce"."vacancies"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_vacancies_position" ON "workforce"."vacancies"("position_id");

-- CreateIndex
CREATE INDEX "idx_vacancies_status" ON "workforce"."vacancies"("status");

-- CreateIndex
CREATE INDEX "idx_vacancies_created" ON "workforce"."vacancies"("created_at");

-- AddForeignKey
ALTER TABLE "workforce"."vacancies" ADD CONSTRAINT "fk_vacancy_position" FOREIGN KEY ("position_id") REFERENCES "workforce"."positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
