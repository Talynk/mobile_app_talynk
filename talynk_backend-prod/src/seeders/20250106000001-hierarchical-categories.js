const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const categoriesData = [
  {
    name: 'Music',
    description: 'All music-related content including various genres and styles',
    level: 1,
    sort_order: 1,
    children: [
      { name: 'Rock', description: 'Rock music and related content', level: 2, sort_order: 1 },
      { name: 'Pop', description: 'Pop music and mainstream content', level: 2, sort_order: 2 },
      { name: 'Hip Hop / Rap', description: 'Hip hop and rap music content', level: 2, sort_order: 3 },
      { name: 'R&B / Soul', description: 'R&B and soul music content', level: 2, sort_order: 4 },
      { name: 'Gospel', description: 'Gospel and Christian music content', level: 2, sort_order: 5 },
      { name: 'Jazz', description: 'Jazz music and improvisation content', level: 2, sort_order: 6 },
      { name: 'Classical', description: 'Classical music and orchestral content', level: 2, sort_order: 7 },
      { name: 'Reggae', description: 'Reggae music and Caribbean sounds', level: 2, sort_order: 8 },
      { name: 'Country', description: 'Country music and folk content', level: 2, sort_order: 9 },
      { name: 'Traditional', description: 'Traditional and folk music content', level: 2, sort_order: 10 },
      { name: 'Electronic/Dance', description: 'Electronic and dance music content', level: 2, sort_order: 11 },
      { name: 'Afrobeats', description: 'Afrobeats and African music content', level: 2, sort_order: 12 },
      { name: 'Blues', description: 'Blues music and related content', level: 2, sort_order: 13 },
      { name: 'Folk', description: 'Folk music and acoustic content', level: 2, sort_order: 14 },
      { name: 'Latin', description: 'Latin music and Hispanic content', level: 2, sort_order: 15 },
      { name: 'K-Pop', description: 'Korean pop music and K-pop content', level: 2, sort_order: 16 },
      { name: 'Other', description: 'Other music genres not listed above', level: 2, sort_order: 17 }
    ]
  },
  {
    name: 'Arts',
    description: 'All visual and creative arts including various artistic disciplines',
    level: 1,
    sort_order: 2,
    children: [
      { name: 'Drawing', description: 'Drawing and sketching content', level: 2, sort_order: 1 },
      { name: 'Painting', description: 'Painting and canvas art content', level: 2, sort_order: 2 },
      { name: 'Sculpture', description: 'Sculpture and 3D art content', level: 2, sort_order: 3 },
      { name: 'Photography', description: 'Photography and visual content', level: 2, sort_order: 4 },
      { name: 'Graphic Design', description: 'Graphic design and digital art content', level: 2, sort_order: 5 },
      { name: 'Fashion Design', description: 'Fashion design and clothing content', level: 2, sort_order: 6 },
      { name: 'Interior Design', description: 'Interior design and home decor content', level: 2, sort_order: 7 },
      { name: 'Ceramics', description: 'Ceramics and pottery content', level: 2, sort_order: 8 },
      { name: 'Architecture', description: 'Architecture and building design content', level: 2, sort_order: 9 },
      { name: 'Calligraphy', description: 'Calligraphy and lettering content', level: 2, sort_order: 10 },
      { name: 'Crafts', description: 'Crafts and handmade content', level: 2, sort_order: 11 },
      { name: 'Other', description: 'Other arts and creative content not listed above', level: 2, sort_order: 12 }
    ]
  },
  {
    name: 'Communication',
    description: 'All communication and speaking-related content',
    level: 1,
    sort_order: 3,
    children: [
      { name: 'Preaching', description: 'Religious preaching and sermon content', level: 2, sort_order: 1 },
      { name: 'Public Speaking', description: 'Public speaking and presentation content', level: 2, sort_order: 2 },
      { name: 'Motivational Speaking', description: 'Motivational speaking and inspiration content', level: 2, sort_order: 3 },
      { name: 'Storytelling', description: 'Storytelling and narrative content', level: 2, sort_order: 4 },
      { name: 'Poetry', description: 'Poetry and spoken word content', level: 2, sort_order: 5 },
      { name: 'Teaching & Training', description: 'Educational and training content', level: 2, sort_order: 6 },
      { name: 'Other', description: 'Other communication content not listed above', level: 2, sort_order: 7 }
    ]
  }
];

async function seedHierarchicalCategories() {
  try {
    console.log('🌱 Starting hierarchical category seeding...');

    // Clear existing categories
    console.log('🗑️  Clearing existing categories...');
    await prisma.category.deleteMany({});
    console.log('✅ Existing categories cleared');

    // Create main categories first
    const musicCategory = await prisma.category.create({
      data: {
        name: 'Music',
        description: 'All music-related content including various genres and styles',
        level: 1,
        sort_order: 1,
        status: 'active'
      }
    });

    const artsCategory = await prisma.category.create({
      data: {
        name: 'Arts',
        description: 'All visual and creative arts including various artistic disciplines',
        level: 1,
        sort_order: 2,
        status: 'active'
      }
    });

    const communicationCategory = await prisma.category.create({
      data: {
        name: 'Communication',
        description: 'All communication and speaking-related content',
        level: 1,
        sort_order: 3,
        status: 'active'
      }
    });

    console.log('✅ Created main categories');

    // Create Music subcategories
    const musicSubcategories = [
      'Rock', 'Pop', 'Hip Hop / Rap', 'R&B / Soul', 'Gospel', 'Jazz', 'Classical',
      'Reggae', 'Country', 'Traditional', 'Electronic/Dance', 'Afrobeats', 'Blues',
      'Folk', 'Latin', 'K-Pop', 'Other'
    ];

    for (let i = 0; i < musicSubcategories.length; i++) {
      await prisma.category.create({
        data: {
          name: musicSubcategories[i],
          description: `${musicSubcategories[i]} music content`,
          level: 2,
          sort_order: i + 1,
          parent_id: musicCategory.id,
          status: 'active'
        }
      });
    }

    console.log('✅ Created Music subcategories');

    // Create Arts subcategories
    const artsSubcategories = [
      'Drawing', 'Painting', 'Sculpture', 'Photography', 'Graphic Design',
      'Fashion Design', 'Interior Design', 'Ceramics', 'Architecture',
      'Calligraphy', 'Crafts', 'Other'
    ];

    for (let i = 0; i < artsSubcategories.length; i++) {
      await prisma.category.create({
        data: {
          name: artsSubcategories[i],
          description: `${artsSubcategories[i]} content`,
          level: 2,
          sort_order: i + 1,
          parent_id: artsCategory.id,
          status: 'active'
        }
      });
    }

    console.log('✅ Created Arts subcategories');

    // Create Communication subcategories
    const communicationSubcategories = [
      'Preaching', 'Public Speaking', 'Motivational Speaking', 'Storytelling',
      'Poetry', 'Teaching & Training', 'Other'
    ];

    for (let i = 0; i < communicationSubcategories.length; i++) {
      await prisma.category.create({
        data: {
          name: communicationSubcategories[i],
          description: `${communicationSubcategories[i]} content`,
          level: 2,
          sort_order: i + 1,
          parent_id: communicationCategory.id,
          status: 'active'
        }
      });
    }

    console.log('✅ Created Communication subcategories');

    // Display summary
    const totalCategories = await prisma.category.count();
    const mainCategories = await prisma.category.count({
      where: { level: 1 }
    });
    const subCategories = await prisma.category.count({
      where: { level: 2 }
    });

    console.log('\n📊 Seeding Summary:');
    console.log(`   Total Categories: ${totalCategories}`);
    console.log(`   Main Categories: ${mainCategories}`);
    console.log(`   Subcategories: ${subCategories}`);

    console.log('\n🎉 Hierarchical category seeding completed successfully!');

  } catch (error) {
    console.error('❌ Error seeding hierarchical categories:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeding
if (require.main === module) {
  seedHierarchicalCategories()
    .then(() => {
      console.log('\n✅ Hierarchical category seeding completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Hierarchical category seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedHierarchicalCategories };
