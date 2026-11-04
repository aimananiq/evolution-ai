-- Capture WhatsApp LID (username privacy) + real phone on conversations, for the LID export.
ALTER TABLE "Conversation" ADD COLUMN "contactLid" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "contactPhoneReal" TEXT;
