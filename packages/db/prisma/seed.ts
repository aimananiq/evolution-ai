import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PLANS = [
  {
    kind: "free" as const,
    name: "Free",
    description: "Try it out — limited usage.",
    contactCap: 200,
    instanceCap: 1,
    monthlyMessageCap: 1000,
    featureFlags: { warmer: false, aiChatbot: false },
  },
  {
    kind: "pro" as const,
    name: "Pro",
    description: "Small teams, up to 5 numbers.",
    contactCap: 10000,
    instanceCap: 5,
    monthlyMessageCap: 50000,
    featureFlags: { warmer: true, aiChatbot: true },
  },
  {
    kind: "enterprise" as const,
    name: "Enterprise",
    description: "Unlimited usage; private servers.",
    contactCap: 1000000,
    instanceCap: 100,
    monthlyMessageCap: 10000000,
    featureFlags: { warmer: true, aiChatbot: true, multiTenantWorkspaceCount: 100 },
  },
];

const PRESETS = [
  {
    name: "balanced",
    description: "Sensible warming pace, suitable for most numbers.",
    config: {
      mode: "pair",
      schedule: { startHour: 9, endHour: 21, skipProbability: 0.2 },
      ramp: { day0: 5, day14: 100, day30: 200 },
      pacing: {
        typingPerCharMs: 130, typingMinMs: 900, typingMaxMs: 8000,
        replyMinMs: 45000, replyMaxMs: 240000,
        minTurnsPerConversation: 3, maxTurnsPerConversation: 7,
      },
      timeOfDayWeights: [0,0,0,0,0,0,0,0,0.3,0.6,0.8,1,1,0.7,0.5,0.5,0.6,0.8,1,1,1,0.7,0.3,0.1],
      dayOfWeekWeights: [1,1,1,1,1,0.9,0.7],
      reactions: { enabled: false, emojis: ["👍","❤️","😂","🙏","😮"] },
    },
  },
  {
    name: "conservative",
    description: "Slow ramp, tight day window, longer reply gaps. Safest.",
    config: {
      mode: "pair",
      schedule: { startHour: 10, endHour: 18, skipProbability: 0.4 },
      ramp: { day0: 2, day14: 40, day30: 80 },
      pacing: {
        typingPerCharMs: 180, typingMinMs: 1500, typingMaxMs: 12000,
        replyMinMs: 90000, replyMaxMs: 480000,
        minTurnsPerConversation: 2, maxTurnsPerConversation: 4,
      },
      timeOfDayWeights: [0,0,0,0,0,0,0,0,0,0,0.5,0.7,0.8,0.6,0.4,0.4,0.5,0.6,0.4,0.2,0,0,0,0],
      dayOfWeekWeights: [1,1,1,1,1,0.6,0.4],
      reactions: { enabled: false, emojis: [] },
    },
  },
  {
    name: "aggressive",
    description: "Faster ramp; only for already-trusted numbers.",
    config: {
      mode: "pair",
      schedule: { startHour: 8, endHour: 23, skipProbability: 0.1 },
      ramp: { day0: 10, day14: 200, day30: 400 },
      pacing: {
        typingPerCharMs: 90, typingMinMs: 600, typingMaxMs: 5000,
        replyMinMs: 20000, replyMaxMs: 120000,
        minTurnsPerConversation: 4, maxTurnsPerConversation: 10,
      },
      timeOfDayWeights: [0,0,0,0,0,0.1,0.3,0.5,0.7,0.9,1,1,1,0.9,0.7,0.7,0.8,1,1,1,1,0.9,0.5,0.2],
      dayOfWeekWeights: [1,1,1,1,1,1,0.9],
      reactions: { enabled: true, emojis: ["👍","❤️","😂","🙏","😮"] },
    },
  },
];

async function main() {
  for (const preset of PRESETS) {
    await prisma.warmerPreset.upsert({
      where: { name: preset.name },
      create: { name: preset.name, description: preset.description, config: preset.config as any },
      update: { description: preset.description, config: preset.config as any },
    });
  }
  console.log(`seeded ${PRESETS.length} warmer presets`);

  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { kind: plan.kind },
      create: plan as any,
      update: { name: plan.name, description: plan.description, contactCap: plan.contactCap, instanceCap: plan.instanceCap, monthlyMessageCap: plan.monthlyMessageCap, featureFlags: plan.featureFlags as any },
    });
  }
  console.log(`seeded ${PLANS.length} plans`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
