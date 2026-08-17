-- CreateEnum
CREATE TYPE "InternalThreadStatus" AS ENUM ('open', 'closed');

-- CreateTable
CREATE TABLE "internal_threads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "from_department_id" TEXT NOT NULL,
    "to_department_id" TEXT NOT NULL,
    "status" "InternalThreadStatus" NOT NULL DEFAULT 'open',
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "internal_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "internal_threads_tenant_id_status_last_message_at_idx" ON "internal_threads"("tenant_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "internal_threads_tenant_id_from_department_id_idx" ON "internal_threads"("tenant_id", "from_department_id");

-- CreateIndex
CREATE INDEX "internal_threads_tenant_id_to_department_id_idx" ON "internal_threads"("tenant_id", "to_department_id");

-- CreateIndex
CREATE INDEX "internal_messages_tenant_id_thread_id_created_at_idx" ON "internal_messages"("tenant_id", "thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "internal_threads" ADD CONSTRAINT "internal_threads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_threads" ADD CONSTRAINT "internal_threads_from_department_id_fkey" FOREIGN KEY ("from_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_threads" ADD CONSTRAINT "internal_threads_to_department_id_fkey" FOREIGN KEY ("to_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_threads" ADD CONSTRAINT "internal_threads_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "internal_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_messages" ADD CONSTRAINT "internal_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
