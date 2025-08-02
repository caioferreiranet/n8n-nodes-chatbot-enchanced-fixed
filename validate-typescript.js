#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

console.log('Running TypeScript validation...');

try {
  // Run TypeScript compiler with no-emit flag to check for errors
  const result = execSync('npx tsc --noEmit', { 
    cwd: __dirname,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  
  console.log('✅ TypeScript compilation successful!');
  console.log('All type errors have been resolved.');
  
  process.exit(0);
  
} catch (error) {
  console.error('❌ TypeScript compilation failed:');
  console.error(error.stdout || error.stderr || error.message);
  
  console.log('\nPlease review the errors above and fix them.');
  process.exit(1);
}