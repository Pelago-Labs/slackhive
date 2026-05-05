#!/usr/bin/env node
// Remove the musl Claude binary on glibc Linux systems.
// When npm install is run with --legacy-peer-deps, npm ignores the
// libc:["musl"] constraint on @anthropic-ai/claude-agent-sdk-linux-x64-musl
// and downloads the binary anyway. The claude-agent-sdk then picks musl first
// (before glibc) and fails to spawn it because the musl dynamic linker is
// absent on glibc systems. Removing the binary causes require.resolve to throw
// for the musl path, so the SDK falls back to the glibc binary.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

if (process.platform !== 'linux') process.exit(0);

const muslBinary = path.join(__dirname, '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64-musl', 'claude');
if (!fs.existsSync(muslBinary)) process.exit(0);

try {
  const ldd = execSync('ldd --version 2>&1').toString();
  if (!ldd.includes('musl')) {
    fs.unlinkSync(muslBinary);
    console.log('postinstall: removed musl Claude binary (glibc system detected)');
  }
} catch {
  // ldd not available or failed — leave binary as-is
}
