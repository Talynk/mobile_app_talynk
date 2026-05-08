const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

describe('Category API Tests', () => {
  beforeAll(async () => {
    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  test('GET /api/categories - should return hierarchical categories', async () => {
    const response = await axios.get(`${BASE_URL}/categories`);
    
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('success');
    expect(Array.isArray(response.data.data)).toBe(true);
    expect(response.data.data.length).toBeGreaterThan(0);
    
    // Check main categories structure
    const mainCategories = response.data.data;
    expect(mainCategories.length).toBe(3); // Music, Arts, Communication
    
    // Check each main category has children
    mainCategories.forEach(category => {
      expect(category.level).toBe(1);
      expect(category.children).toBeDefined();
      expect(Array.isArray(category.children)).toBe(true);
      expect(category.children.length).toBeGreaterThan(0);
      
      // Check subcategories structure
      category.children.forEach(subcategory => {
        expect(subcategory.level).toBe(2);
        expect(subcategory.parent_id).toBe(category.id);
      });
    });
  });

  test('GET /api/categories/:parentId/subcategories - should return subcategories for Music', async () => {
    // First get the Music category ID
    const categoriesResponse = await axios.get(`${BASE_URL}/categories`);
    const musicCategory = categoriesResponse.data.data.find(cat => cat.name === 'Music');
    expect(musicCategory).toBeDefined();
    
    const response = await axios.get(`${BASE_URL}/categories/${musicCategory.id}/subcategories`);
    
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('success');
    expect(Array.isArray(response.data.data)).toBe(true);
    expect(response.data.data.length).toBe(17); // Music has 17 subcategories
    
    // Check subcategories are all level 2 and belong to Music
    response.data.data.forEach(subcategory => {
      expect(subcategory.level).toBe(2);
      expect(subcategory.parent_id).toBe(musicCategory.id);
    });
  });

  test('GET /api/categories/:id - should return specific category details', async () => {
    // Get a category ID from the main categories
    const categoriesResponse = await axios.get(`${BASE_URL}/categories`);
    const firstCategory = categoriesResponse.data.data[0];
    
    const response = await axios.get(`${BASE_URL}/categories/${firstCategory.id}`);
    
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('success');
    expect(response.data.data).toBeDefined();
    expect(response.data.data.id).toBe(firstCategory.id);
    expect(response.data.data.name).toBe(firstCategory.name);
  });

  test('GET /api/categories/popular - should return popular categories', async () => {
    const response = await axios.get(`${BASE_URL}/categories/popular`);
    
    expect(response.status).toBe(200);
    expect(response.data.status).toBe('success');
    expect(Array.isArray(response.data.data)).toBe(true);
    expect(response.data.data.length).toBeGreaterThan(0);
    
    // Check that categories have post counts
    response.data.data.forEach(category => {
      expect(category._count).toBeDefined();
      expect(category._count.posts).toBeDefined();
      expect(typeof category._count.posts).toBe('number');
    });
  });

  test('Category hierarchy should be properly structured', async () => {
    const response = await axios.get(`${BASE_URL}/categories`);
    const categories = response.data.data;
    
    // Check that we have the expected main categories
    const categoryNames = categories.map(cat => cat.name);
    expect(categoryNames).toContain('Music');
    expect(categoryNames).toContain('Arts');
    expect(categoryNames).toContain('Communication');
    
    // Check Music subcategories
    const musicCategory = categories.find(cat => cat.name === 'Music');
    const musicSubcategories = musicCategory.children.map(sub => sub.name);
    expect(musicSubcategories).toContain('Rock');
    expect(musicSubcategories).toContain('Pop');
    expect(musicSubcategories).toContain('Hip Hop / Rap');
    expect(musicSubcategories).toContain('R&B / Soul');
    
    // Check Arts subcategories
    const artsCategory = categories.find(cat => cat.name === 'Arts');
    const artsSubcategories = artsCategory.children.map(sub => sub.name);
    expect(artsSubcategories).toContain('Drawing');
    expect(artsSubcategories).toContain('Painting');
    expect(artsSubcategories).toContain('Photography');
    
    // Check Communication subcategories
    const communicationCategory = categories.find(cat => cat.name === 'Communication');
    const communicationSubcategories = communicationCategory.children.map(sub => sub.name);
    expect(communicationSubcategories).toContain('Preaching');
    expect(communicationSubcategories).toContain('Public Speaking');
    expect(communicationSubcategories).toContain('Poetry');
  });

  test('Categories should have proper sort order', async () => {
    const response = await axios.get(`${BASE_URL}/categories`);
    const categories = response.data.data;
    
    // Check main categories are sorted by sort_order
    for (let i = 1; i < categories.length; i++) {
      expect(categories[i].sort_order).toBeGreaterThanOrEqual(categories[i-1].sort_order);
    }
    
    // Check subcategories are sorted by sort_order
    categories.forEach(category => {
      if (category.children.length > 1) {
        for (let i = 1; i < category.children.length; i++) {
          expect(category.children[i].sort_order).toBeGreaterThanOrEqual(category.children[i-1].sort_order);
        }
      }
    });
  });
});
