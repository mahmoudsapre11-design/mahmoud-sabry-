import 'dotenv/config';
import { ApplicationStatus, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertUser(email: string, password: string, fullName: string, role: Role, phone?: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, password: await bcrypt.hash(password, 10), fullName, role, phone },
  });
}

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@sanad.local';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin@12345';

  // ---------- users ----------
  const admin = await upsertUser(adminEmail, adminPassword, 'Sanad Admin', Role.ADMIN);
  const sup1 = await upsertUser('supervisor@sanad.local', 'Supervisor@12345', 'Layla Hassan', Role.SUPERVISOR, '0790000001');
  const sup2 = await upsertUser('supervisor2@sanad.local', 'Supervisor@12345', 'Omar Khalil', Role.SUPERVISOR, '0790000002');
  const youth = [
    await upsertUser('youth1@sanad.local', 'Youth@12345', 'Sara Ahmad', Role.YOUTH, '0780000001'),
    await upsertUser('youth2@sanad.local', 'Youth@12345', 'Yousef Nasser', Role.YOUTH, '0780000002'),
    await upsertUser('youth3@sanad.local', 'Youth@12345', 'Dana Mansour', Role.YOUTH, '0780000003'),
  ];

  // ---------- programs (+ sessions) ----------
  const programDefs = [
    {
      title: 'Leadership Workshop',
      description: 'A hands-on workshop that develops leadership and teamwork skills for young people.',
      totalSeats: 20,
      supervisorId: sup1.id,
      sessions: [
        { date: new Date('2026-12-01'), startTime: '10:00', endTime: '12:00', location: 'Main Hall' },
        { date: new Date('2026-12-08'), startTime: '10:00', endTime: '12:00', location: 'https://meet.example.com/leadership' },
      ],
    },
    {
      title: 'Web Development Bootcamp',
      description: 'Learn HTML, CSS, JavaScript and build your first full website in four weeks.',
      totalSeats: 2, // small on purpose: easy to demo "no seats left"
      supervisorId: sup1.id,
      sessions: [{ date: new Date('2026-12-03'), startTime: '14:00', endTime: '17:00', location: 'Computer Lab 2' }],
    },
    {
      title: 'Public Speaking & Communication',
      description: 'Practical training on presentations, confidence and effective communication.',
      totalSeats: 15,
      supervisorId: sup2.id,
      sessions: [{ date: new Date('2026-12-05'), startTime: '09:30', endTime: '11:30', location: 'https://meet.example.com/speaking' }],
    },
    {
      title: 'Entrepreneurship Essentials',
      description: 'From idea to business model: validate your idea and pitch it to investors.',
      totalSeats: 25,
      supervisorId: sup2.id,
      sessions: [{ date: new Date('2026-12-10'), startTime: '16:00', endTime: '18:00', location: 'Innovation Room' }],
    },
  ];

  const programs: { id: number; title: string; totalSeats: number }[] = [];
  for (const def of programDefs) {
    const existing = await prisma.program.findFirst({ where: { title: def.title } });
    if (existing) {
      programs.push(existing);
      continue;
    }
    const { sessions, ...data } = def;
    programs.push(
      await prisma.program.create({
        data: { ...data, availableSeats: data.totalSeats, sessions: { create: sessions } },
      }),
    );
  }
  const [leadership, webdev, speaking] = programs;

  // ---------- sample applications (all statuses) ----------
  const applications: [number, number, ApplicationStatus][] = [
    [youth[0].id, leadership.id, ApplicationStatus.ACCEPTED],
    [youth[1].id, leadership.id, ApplicationStatus.PENDING],
    [youth[2].id, leadership.id, ApplicationStatus.REJECTED],
    [youth[0].id, webdev.id, ApplicationStatus.PENDING],
    [youth[1].id, webdev.id, ApplicationStatus.PENDING], // webdev is now full (2/2)
    [youth[2].id, speaking.id, ApplicationStatus.CANCELLED],
  ];
  for (const [userId, programId, status] of applications) {
    await prisma.application.upsert({
      where: { userId_programId: { userId, programId } },
      update: {},
      create: { userId, programId, status },
    });
  }

  // Keep availableSeats consistent: total - (PENDING + ACCEPTED)
  for (const program of programs) {
    const held = await prisma.application.count({
      where: { programId: program.id, status: { in: [ApplicationStatus.PENDING, ApplicationStatus.ACCEPTED] } },
    });
    await prisma.program.update({
      where: { id: program.id },
      data: { availableSeats: program.totalSeats - held },
    });
  }

  // ---------- announcements ----------
  const announcements = [
    { title: 'Welcome to Sanad Youth', content: 'Browse the programs and apply to the ones that fit you.', authorId: admin.id, programId: null },
    { title: 'Registration is open', content: 'New programs start in December. Seats are limited!', authorId: admin.id, programId: null },
    { title: 'Leadership Workshop: what to bring', content: 'Bring a notebook and be on time for the first session.', authorId: sup1.id, programId: leadership.id },
  ];
  for (const a of announcements) {
    const exists = await prisma.announcement.findFirst({ where: { title: a.title } });
    if (!exists) await prisma.announcement.create({ data: a });
  }

  console.log('Seed done.\n');
  console.log(`Admin:       ${adminEmail} / ${adminPassword}`);
  console.log('Supervisors: supervisor@sanad.local, supervisor2@sanad.local / Supervisor@12345');
  console.log('Youth:       youth1@sanad.local, youth2@sanad.local, youth3@sanad.local / Youth@12345');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
