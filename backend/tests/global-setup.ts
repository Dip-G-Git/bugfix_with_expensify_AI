import { execSync } from 'child_process';

export default function globalSetup() {
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: 'file:./test.db', NODE_ENV: 'test' },
    stdio: 'pipe',
  });
}
