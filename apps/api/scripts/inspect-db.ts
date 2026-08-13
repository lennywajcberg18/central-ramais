import { prisma } from '../src/prisma';

async function main() {
  const fb = await prisma.feedback.findMany();
  console.log('feedback:', fb.map((f) => ({ score: f.score, comment: f.comment })));
  const attempts = await prisma.accessAttempt.findMany();
  console.log('attempts:', attempts.map((a) => ({ num: a.waNumber, reason: a.reason, code: a.entryCodeTried })));
  const conv = await prisma.conversation.findMany({
    select: { status: true, closeReason: true, firstReplyAt: true, entryLinkLabelSnapshot: true },
  });
  console.log('conversas:', JSON.stringify(conv, null, 1));
}

main().finally(() => prisma.$disconnect());
