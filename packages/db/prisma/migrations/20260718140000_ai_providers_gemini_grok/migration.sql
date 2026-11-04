-- Add Gemini + Grok to the AI provider enum.
ALTER TYPE "AiProvider" ADD VALUE IF NOT EXISTS 'gemini';
ALTER TYPE "AiProvider" ADD VALUE IF NOT EXISTS 'grok';
