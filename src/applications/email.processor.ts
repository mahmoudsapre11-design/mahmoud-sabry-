import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export interface ApplicationEmailJob {
  userId: number;
  programId: number;
  status: string;
}

/**
 * Worker: consumes the "email" queue. The job carries IDs only; the data is
 * loaded here so the email always reflects fresh information.
 * Retries may run a job twice, so the handler is idempotent (it only sends/logs).
 */
@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<ApplicationEmailJob>): Promise<void> {
    const { userId, programId, status } = job.data;
    const [user, program] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } }),
      this.prisma.program.findUnique({ where: { id: programId }, select: { title: true } }),
    ]);
    if (!user || !program) return; // user or program was deleted meanwhile

    // Simulate a slow external email provider (replace with a real mail service)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    this.logger.log(
      `Email sent to ${user.email}: application for "${program.title}" is now ${status} (job ${job.id})`,
    );
  }
}
