-- Cumulative send-pacing cursor for broadcasts (fixes bursty sends: each message
-- is now scheduled at previous-slot + gap instead of an independent random delay).
ALTER TABLE "Broadcast" ADD COLUMN "nextSlotAt" TIMESTAMP(3);
