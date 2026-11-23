import { expect, test } from 'e2e';

// Tests that run apart import this file again, so each sees only its own writes.
test.describe.configure({ parallel: true });

let ran = 0;

for (const title of ['opens the todos', 'opens the todos again']) {
  test(title, { tags: ['parallel'] }, async ({ app, screen }) => {
    ran += 1;
    await app.open('/todos');
    await expect(screen.getByLabel('New todo')).toBeVisible();
    expect(ran).toBe(1);
  });
}

test.describe('in order', { parallel: false, tags: ['parallel'] }, () => {
  test('adds a todo', async ({ app, screen }) => {
    ran += 1;
    await app.open('/todos');
    await screen.getByLabel('New todo').fill('Run in order');
    await screen.getByLabel('New todo').press('Enter');
    await expect(screen.getByTestId('todo')).toContainText(['Run in order']);
  });

  test('runs after it, in the same import of the file', () => {
    expect(ran).toBe(1);
  });
});
