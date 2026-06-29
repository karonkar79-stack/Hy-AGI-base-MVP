/** Jest configuration — TypeScript via ts-jest. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Match *.test.ts files anywhere under src/ (and a future tests/ dir).
  testMatch: ['**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Don't fail the whole command before any real tests are written.
  passWithNoTests: true,
};
