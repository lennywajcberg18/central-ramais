-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'agent');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('available', 'away', 'offline');

-- CreateEnum
CREATE TYPE "EntryLinkKind" AS ENUM ('profile', 'nominal');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('awaiting_department', 'open', 'assigned', 'awaiting_menu_confirm', 'awaiting_feedback', 'closed');

-- CreateEnum
CREATE TYPE "CloseReason" AS ENUM ('agent_closed', 'timeout', 'user_switched', 'access_revoked', 'no_agent_available');

-- CreateEnum
CREATE TYPE "AccessAttemptReason" AS ENUM ('no_code', 'invalid_code', 'revoked_link', 'nominal_taken', 'blocked');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('customer', 'agent', 'system');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "csat_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_numbers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'twilio',
    "phone_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "menu_key" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "availability" "Availability" NOT NULL DEFAULT 'offline',
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_departments" (
    "user_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,

    CONSTRAINT "user_departments_pkey" PRIMARY KEY ("user_id","department_id")
);

-- CreateTable
CREATE TABLE "entry_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "entry_code" TEXT NOT NULL,
    "kind" "EntryLinkKind" NOT NULL,
    "label" TEXT NOT NULL,
    "holder_note" TEXT,
    "prefill_text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT,

    CONSTRAINT "entry_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_link_departments" (
    "entry_link_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,

    CONSTRAINT "entry_link_departments_pkey" PRIMARY KEY ("entry_link_id","department_id")
);

-- CreateTable
CREATE TABLE "external_contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "wa_number" TEXT NOT NULL,
    "entry_link_id" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_attempts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "wa_number" TEXT NOT NULL,
    "entry_code_tried" TEXT,
    "reason" "AccessAttemptReason" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "whatsapp_number_id" TEXT NOT NULL,
    "external_contact_id" TEXT NOT NULL,
    "department_id" TEXT,
    "entry_link_id" TEXT NOT NULL,
    "entry_link_label_snapshot" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL,
    "assigned_user_id" TEXT,
    "close_reason" "CloseReason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_at" TIMESTAMP(3),
    "first_reply_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "menu_retries" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "sender_type" "SenderType" NOT NULL,
    "body" TEXT NOT NULL,
    "wa_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "score" INTEGER,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_numbers_tenant_id_idx" ON "whatsapp_numbers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_numbers_phone_number_key" ON "whatsapp_numbers"("phone_number");

-- CreateIndex
CREATE INDEX "departments_tenant_id_active_idx" ON "departments"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_menu_key_key" ON "departments"("tenant_id", "menu_key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "entry_links_slug_key" ON "entry_links"("slug");

-- CreateIndex
CREATE INDEX "entry_links_tenant_id_idx" ON "entry_links"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "entry_links_tenant_id_entry_code_key" ON "entry_links"("tenant_id", "entry_code");

-- CreateIndex
CREATE INDEX "external_contacts_tenant_id_entry_link_id_idx" ON "external_contacts"("tenant_id", "entry_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_contacts_tenant_id_wa_number_key" ON "external_contacts"("tenant_id", "wa_number");

-- CreateIndex
CREATE INDEX "access_attempts_tenant_id_created_at_idx" ON "access_attempts"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_external_contact_id_status_idx" ON "conversations"("tenant_id", "external_contact_id", "status");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_department_id_status_idx" ON "conversations"("tenant_id", "department_id", "status");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_status_last_message_at_idx" ON "conversations"("tenant_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_entry_link_id_idx" ON "conversations"("tenant_id", "entry_link_id");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_created_at_idx" ON "conversations"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_wa_message_id_key" ON "messages"("wa_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_conversation_id_key" ON "feedback"("conversation_id");

-- AddForeignKey
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_departments" ADD CONSTRAINT "user_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_links" ADD CONSTRAINT "entry_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_link_departments" ADD CONSTRAINT "entry_link_departments_entry_link_id_fkey" FOREIGN KEY ("entry_link_id") REFERENCES "entry_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_link_departments" ADD CONSTRAINT "entry_link_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_contacts" ADD CONSTRAINT "external_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_contacts" ADD CONSTRAINT "external_contacts_entry_link_id_fkey" FOREIGN KEY ("entry_link_id") REFERENCES "entry_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_attempts" ADD CONSTRAINT "access_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_whatsapp_number_id_fkey" FOREIGN KEY ("whatsapp_number_id") REFERENCES "whatsapp_numbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_external_contact_id_fkey" FOREIGN KEY ("external_contact_id") REFERENCES "external_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_entry_link_id_fkey" FOREIGN KEY ("entry_link_id") REFERENCES "entry_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
