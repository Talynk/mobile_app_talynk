const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const CATEGORY_STATUS = 'active';

const hierarchy = [
  {
    name: 'Music',
    description: 'Music-related content',
    sort_order: 1,
    children: [
      'Rock',
      'Pop',
      'Hip Hop / Rap',
      'R&B / Soul',
      'Gospel',
      'Jazz',
      'Classical',
      'Reggae',
      'Country',
      'Traditional',
      'Electronic/Dance',
      'Afrobeats',
      'Blues',
      'Folk',
      'Latin',
      'K-Pop',
      'Other'
    ]
  },
  {
    name: 'Arts',
    description: 'Arts-related content',
    sort_order: 2,
    children: [
      'Drawing',
      'Painting',
      'Sculpture',
      'Photography',
      'Graphic design',
      'Fashion design',
      'Interior design',
      'Ceramics',
      'Architecture',
      'Calligraphy',
      'Crafts',
      'Other'
    ]
  },
  {
    name: 'Communication',
    description: 'Communication-related content',
    sort_order: 3,
    children: [
      'Preaching',
      'Public speaking',
      'Motivational speaking',
      'Storytelling',
      'Poetry',
      'Teaching & Training',
      'Other'
    ]
  },
  {
    name: 'Physical Appearance',
    description: 'Physical appearance related content',
    sort_order: 4,
    children: [
      'Women Beauty',
      'Men'
    ]
  },
  {
    name: 'Sport',
    description: 'Sport-related content',
    sort_order: 5,
    children: [
      'Football',
      'Volleyball',
      'Basketball',
      'Handball',
      'Tennis',
      'Table tennis',
      'Golf',
      'Cricket',
      'Rugby',
      'Acrobatics',
      'Other'
    ]
  },
  {
    name: 'Performance',
    description: 'Performance-related content',
    sort_order: 6,
    children: [
      'Drama/Theatre',
      'Dance',
      'Comedy',
      'Other'
    ]
  },
  {
    name: 'Martial Arts',
    description: 'Martial arts and combat sports content',
    sort_order: 7,
    children: [
      'Karate',
      'Kung Fu (Wushu)',
      'Boxing',
      'Taekwondo',
      'Kickboxing',
      'Muay Thai',
      'Judo',
      'Aikido',
      'Jiu-Jitsu',
      'Other'
    ]
  }
];

async function upsertCategory({ name, description, level, sort_order, parent_id = null }) {
  return prisma.category.upsert({
    where: {
      // We assume name+parent are unique enough for upsert; adjust if you have a unique constraint
      // If only name is unique globally in your schema, this will still work.
      name
    },
    update: {
      description,
      status: CATEGORY_STATUS,
      level,
      sort_order,
      parent_id
    },
    create: {
      name,
      description,
      status: CATEGORY_STATUS,
      level,
      sort_order,
      parent_id
    }
  });
}

async function seedHierarchy() {
  console.log('🌱 Seeding category hierarchy...');

  for (const top of hierarchy) {
    // Upsert parent (level 1)
    const parent = await upsertCategory({
      name: top.name,
      description: top.description,
      level: 1,
      sort_order: top.sort_order,
      parent_id: null
    });
    console.log(`✅ Upserted parent: ${parent.name}`);

    // Upsert children (level 2)
    let childOrder = 1;
    for (const childName of top.children) {
      const child = await upsertCategory({
        name: childName,
        description: `${childName} under ${top.name}`,
        level: 2,
        sort_order: childOrder++,
        parent_id: parent.id
      });
      console.log(`   ↳ Upserted child: ${child.name}`);
    }
  }

  console.log('🎉 Category hierarchy seeding complete.');
}

seedHierarchy()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
