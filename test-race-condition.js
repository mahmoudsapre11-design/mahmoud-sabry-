/**
 * Last-seat race condition test.
 *
 * Creates a program with ONE seat, then fires N applications from N different
 * youth accounts at the same instant. Expected result:
 *   - exactly 1 response 201 (the seat winner)
 *   - N-1 responses 409 (clear "No seats available" answer)
 *   - availableSeats = 0 and exactly 1 active application in the database
 *
 * Usage:  1) npm run infra:up   2) npx prisma migrate dev   3) npm run start:dev
 *         4) node test-race-condition.js [numberOfUsers]
 *
 * Tokens are signed directly with JWT_SECRET so the test does not hit the
 * strict login throttle (5/min). Keep N <= 80 to stay under the global limit
 * of 100 requests/min per IP.
 */
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const USERS = Number(process.argv[2] || process.env.RACE_USERS || 30);
const prisma = new PrismaClient();

async function main() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET missing in .env');
  if (USERS > 80) throw new Error('Use at most 80 users (global throttle is 100 requests/min)');

  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!health || !health.ok) throw new Error(`Server is not reachable at ${BASE_URL}. Start it first.`);

  const passwordHash = await bcrypt.hash('Race@12345', 4);

  const supervisor = await prisma.user.upsert({
    where: { email: 'race-supervisor@test.local' },
    update: {},
    create: { email: 'race-supervisor@test.local', password: passwordHash, fullName: 'Race Supervisor', role: 'SUPERVISOR' },
  });

  const program = await prisma.program.create({
    data: {
      title: `Race Test ${new Date().toISOString()}`,
      description: 'Program with a single seat used to test the last-seat race condition',
      totalSeats: 1,
      availableSeats: 1,
      supervisorId: supervisor.id,
    },
  });

  const users = [];
  for (let i = 1; i <= USERS; i++) {
    users.push(
      await prisma.user.upsert({
        where: { email: `race-user-${i}@test.local` },
        update: {},
        create: { email: `race-user-${i}@test.local`, password: passwordHash, fullName: `Race User ${i}`, role: 'YOUTH' },
      }),
    );
  }
  const tokens = users.map((u) =>
    jwt.sign({ sub: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' }),
  );

  console.log(`Program #${program.id} created with 1 seat. Firing ${USERS} simultaneous applications...`);

  const started = Date.now();
  const results = await Promise.all(
    tokens.map(async (token, i) => {
      const res = await fetch(`${BASE_URL}/programs/${program.id}/applications`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      return { user: i + 1, status: res.status, message: body.message };
    }),
  );
  const elapsed = Date.now() - started;

  const byStatus = {};
  results.forEach((r) => (byStatus[r.status] = (byStatus[r.status] || 0) + 1));
  console.log('Response codes:', byStatus, `(${elapsed} ms)`);
  const winners = results.filter((r) => r.status === 201);
  const losers = results.filter((r) => r.status === 409);
  console.log('Winner(s):', winners.map((w) => `user ${w.user}`).join(', ') || 'none');
  if (losers[0]) console.log('Sample loser message:', losers[0].message);

  const after = await prisma.program.findUnique({ where: { id: program.id } });
  const activeApps = await prisma.application.count({
    where: { programId: program.id, status: { in: ['PENDING', 'ACCEPTED'] } },
  });
  console.log(`DB state -> availableSeats: ${after.availableSeats}, active applications: ${activeApps}`);

  const ok =
    winners.length === 1 &&
    losers.length === USERS - 1 &&
    after.availableSeats === 0 &&
    activeApps === 1;

  console.log(ok ? '\nPASS: no overbooking, every user got a clear answer.' : '\nFAIL: unexpected result!');
  process.exitCode = ok ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
