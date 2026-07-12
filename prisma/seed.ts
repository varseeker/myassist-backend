import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { RoleType } from '@prisma/client';
import { createPrismaClient } from '../src/prisma/create-prisma-client';

const prisma = createPrismaClient(process.env.DIRECT_URL ?? process.env.DATABASE_URL);

const roles: { name: RoleType; description: string }[] = [
  { name: RoleType.ADMIN, description: 'Full system access' },
  { name: RoleType.QA, description: 'Review, assign, and validate tickets' },
  { name: RoleType.DEVELOPER, description: 'Work on and resolve assigned tickets' },
  { name: RoleType.USER, description: 'Create and track own tickets' },
];

const defaultUsers = [
  {
    username: 'admin',
    email: 'admin@myassist.local',
    password: 'Admin123!',
    fullName: 'System Admin',
    role: RoleType.ADMIN,
    projectIds: [] as string[],
  },
  {
    username: 'qa',
    email: 'qa@myassist.local',
    password: 'Qa123456!',
    fullName: 'QA Tester',
    role: RoleType.QA,
    projectIds: [] as string[],
  },
  {
    username: 'dev',
    email: 'dev@myassist.local',
    password: 'Dev123456!',
    fullName: 'Developer User',
    role: RoleType.DEVELOPER,
    projectIds: [] as string[],
  },
  {
    username: 'user',
    email: 'user@myassist.local',
    password: 'User123456!',
    fullName: 'Regular User',
    role: RoleType.USER,
    projectIds: [] as string[],
  },
];

async function main() {
  for (const role of roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }

  const project = await prisma.project.upsert({
    where: { code: 'MYA-CORE' },
    update: {
      name: 'MyAssist Core',
      description: 'Default active project for internal service desk operations',
      isActive: true,
      deletedAt: null,
    },
    create: {
      name: 'MyAssist Core',
      code: 'MYA-CORE',
      description: 'Default active project for internal service desk operations',
      isActive: true,
    },
  });

  await prisma.sprint.updateMany({
    where: { projectId: project.id, isActive: true },
    data: { isActive: false },
  });

  const sprint = await prisma.sprint.create({
    data: {
      projectId: project.id,
      name: 'Sprint 1',
      goal: 'Initial rollout of project-based ticket workflow',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T23:59:59.000Z'),
      isActive: true,
    },
  });

  for (const user of defaultUsers) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { name: user.role },
    });
    const passwordHash = await bcrypt.hash(user.password, 12);

    const savedUser = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        username: user.username,
        fullName: user.fullName,
        passwordHash,
        roleId: role.id,
        isActive: true,
        deletedAt: null,
      },
      create: {
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        passwordHash,
        roleId: role.id,
      },
    });

    await prisma.userProject.deleteMany({ where: { userId: savedUser.id } });

    const projectIds =
      user.role === RoleType.ADMIN
        ? []
        : user.role === RoleType.USER
          ? [project.id]
          : [project.id];

    if (projectIds.length > 0) {
      await prisma.userProject.createMany({
        data: projectIds.map((projectId) => ({
          userId: savedUser.id,
          projectId,
        })),
        skipDuplicates: true,
      });
    }
  }

  console.log('Seeded roles:', roles.map((r) => r.name).join(', '));
  console.log('Seeded project:', project.code);
  console.log('Seeded active sprint:', sprint.name);
  console.log(
    'Seeded users:',
    defaultUsers.map((u) => `${u.username} / ${u.email} (${u.role})`).join(', '),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
