import { HomepageSectionKey } from '@prisma/client';

export const HOMEPAGE_SECTION_DEFAULTS: Array<{
  key: HomepageSectionKey;
  label: string;
  sortOrder: number;
  content: Record<string, unknown>;
}> = [
  {
    key: HomepageSectionKey.HERO,
    label: 'Hero',
    sortOrder: 10,
    content: {
      badge: 'Internal Service Desk Platform',
      headline: 'Manage support requests with clarity and speed',
      body: "MyAssist is Azure Enterprise's modern service desk — organize support by project and sprint, assign the right teams, and track every ticket from submission to resolution.",
      primaryCtaLabel: 'Get started',
      primaryCtaLabelAuthed: 'Go to dashboard',
      secondaryCtaLabel: 'See how it works',
      secondaryCtaHref: '#workflow',
    },
  },
  {
    key: HomepageSectionKey.HIGHLIGHTS,
    label: 'Highlights',
    sortOrder: 20,
    content: {
      items: [
        {
          iconKey: 'FolderKanban',
          label: 'Project & sprint scope',
          detail: 'Tickets organized by project and sprint',
        },
        {
          iconKey: 'Zap',
          label: 'Real-time updates',
          detail: 'Live notifications via WebSocket',
        },
        {
          iconKey: 'Shield',
          label: 'Role-based access',
          detail: 'Admin, QA, Developer & User roles',
        },
      ],
    },
  },
  {
    key: HomepageSectionKey.FEATURES,
    label: 'Features',
    sortOrder: 30,
    content: {
      heading: 'Everything your service desk needs',
      subheading:
        'A complete toolkit for internal support — designed to be simple for requesters and powerful for your operations team.',
      items: [
        {
          iconKey: 'FolderKanban',
          title: 'Project Management',
          description:
            'Organize work by active projects. Each project maintains its own tickets, members, and sprint backlog.',
        },
        {
          iconKey: 'Layers',
          title: 'Sprint Planning',
          description:
            'Break projects into sprints. Every ticket is linked to a project and an active sprint for clear delivery cycles.',
        },
        {
          iconKey: 'Ticket',
          title: 'Ticket Management',
          description:
            'Submit bug reports, issues, enhancements, and support requests with priority, type, and full traceability.',
        },
        {
          iconKey: 'Users',
          title: 'Project-based Teams',
          description:
            'Users belong to one project. QA and Developers can collaborate across multiple projects simultaneously.',
        },
        {
          iconKey: 'Workflow',
          title: 'Structured Workflow',
          description:
            'Tickets flow through QA review, assignment, in-progress work, and resolution with complete audit history.',
        },
        {
          iconKey: 'MessageSquare',
          title: 'Team Collaboration',
          description:
            'Discuss tickets with comments and @username mentions. Attach files and receive real-time notifications on every update.',
        },
        {
          iconKey: 'Bell',
          title: 'Real-time Notifications',
          description:
            'Instant alerts when tickets are assigned, updated, commented on, or when you are mentioned.',
        },
        {
          iconKey: 'BarChart3',
          title: 'Dashboard Analytics',
          description:
            'Monitor ticket volume, priorities, and trends scoped to your projects and role.',
        },
      ],
    },
  },
  {
    key: HomepageSectionKey.PROJECTS,
    label: 'Projects',
    sortOrder: 40,
    content: {
      heading: 'Built around projects & sprints',
      subheading:
        'Every piece of work lives inside a project. Sprints give your team a focused delivery window — so nothing gets lost between teams or releases.',
      items: [
        {
          iconKey: 'FolderKanban',
          title: 'Active projects',
          description:
            'Admins maintain a list of active projects. Each project has its own members, sprints, and ticket backlog.',
        },
        {
          iconKey: 'Layers',
          title: 'Sprint cycles',
          description:
            'Tickets are created against the current active sprint, keeping work aligned with your delivery timeline.',
        },
        {
          iconKey: 'Users',
          title: 'Team assignments',
          description:
            'Users are bound to one project. QA and Developers can work across multiple projects at the same time.',
        },
      ],
    },
  },
  {
    key: HomepageSectionKey.WORKFLOW,
    label: 'Workflow',
    sortOrder: 50,
    content: {
      heading: 'How it works',
      subheading:
        'A clear, traceable path from request to resolution — so nothing falls through the cracks.',
      steps: [
        {
          step: '01',
          title: 'Set up projects',
          description:
            'Admins create active projects, define sprints, and assign users to the right teams.',
        },
        {
          step: '02',
          title: 'Submit to a sprint',
          description:
            'Users create tickets tied to their project and the current active sprint.',
        },
        {
          step: '03',
          title: 'QA & development',
          description:
            'QA reviews and assigns work. Developers resolve tickets within their assigned projects.',
        },
        {
          step: '04',
          title: 'Track & notify',
          description:
            'Everyone follows ticket activity, comments, and status changes in real time until closure.',
        },
      ],
    },
  },
  {
    key: HomepageSectionKey.CLIENTS,
    label: 'Our Clients',
    sortOrder: 60,
    content: {
      eyebrow: 'Our Clients',
      heading: 'Trusted by organizations we support',
      subheading:
        'Partners we assist in daily service desk operations and digital collaboration.',
    },
  },
  {
    key: HomepageSectionKey.CTA,
    label: 'Call to action',
    sortOrder: 70,
    content: {
      heading: 'Ready to streamline your support?',
      body: 'Sign in to manage projects, submit sprint-scoped tickets, and collaborate with your Azure Enterprise team.',
      ctaLabel: 'Sign in to MyAssist',
      ctaHref: '/login',
    },
  },
];
