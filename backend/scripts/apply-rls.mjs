import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

async function main() {
  const sqlPath = path.resolve(process.cwd(), '../admin/setup-rls.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log("Applying RLS setup via pg...");

  const client = new Client({
    connectionString: process.env.DIRECT_URL
  });

  await client.connect();

  try {
    await client.query(sql);
    console.log('✅ Executed all RLS statements successfully.');
  } catch (e) {
    console.error('❌ Failed to execute RLS setup:');
    console.error(e.message);
  } finally {
    await client.end();
  }

  console.log("Done.");
}

main();
