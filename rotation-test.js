#!/usr/bin/env node

/**
 * Coronium Rotation Test - Direct API approach
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = process.env.CORONIUM_BASE_URL || 'https://api.coronium.io/v1';
const LOGIN = process.env.CORONIUM_LOGIN;
const PASSWORD = process.env.CORONIUM_PASSWORD;

console.log('🧪 Coronium Rotation Test\n');

if (!LOGIN || !PASSWORD) {
  console.error('❌ Missing credentials in .env');
  process.exit(1);
}

async function main() {
  let authToken;

  // Step 1: Authenticate
  console.log('Step 1: Authenticating...');
  try {
    const authResp = await axios.post(`${API_BASE}/get-token`, {
      login: LOGIN,
      password: PASSWORD
    });
    authToken = authResp.data.token;
    console.log('✅ Authenticated\n');
  } catch (error) {
    console.error('❌ Auth failed:', error.response?.data || error.message);
    process.exit(1);
  }

  // Step 2: Get proxies
  console.log('Step 2: Fetching proxies...');
  let proxies;
  try {
    const proxiesResp = await axios.get(`${API_BASE}/account/proxies`, {
      params: { auth_token: authToken }
    });
    proxies = proxiesResp.data.data || [];
    console.log(`✅ Found ${proxies.length} proxies\n`);

    proxies.forEach((p, i) => {
      console.log(`${i + 1}. ${p.name}`);
      console.log(`   ID: ${p._id}`);
      console.log(`   IP: ${p.ext_ip}`);
      console.log(`   Rotation: ${p.restartToken ? '✅' : '❌'}\n`);
    });
  } catch (error) {
    console.error('❌ Failed:', error.response?.data || error.message);
    process.exit(1);
  }

  // Step 3: Select proxy
  const targetProxy = proxies.find(p => p.restartToken);
  if (!targetProxy) {
    console.log('❌ No proxy with rotation token');
    process.exit(1);
  }

  console.log(`🎯 Selected: ${targetProxy.name}`);
  console.log(`   Current IP: ${targetProxy.ext_ip}\n`);
  console.log('⏳ Waiting 3 seconds before rotation...\n');
  await new Promise(r => setTimeout(r, 3000));

  // Step 4: Rotate
  console.log('Step 3: Rotating IP...');
  const oldIp = targetProxy.ext_ip;

  try {
    const rotateUrl = targetProxy.restartByToken ||
      `https://mreset.xyz/restart-modem/${targetProxy.restartToken}`;

    await axios.get(rotateUrl, { timeout: 30000 });
    console.log('✅ Rotation initiated\n');

    console.log('⏳ Waiting 10s for modem restart...');
    await new Promise(r => setTimeout(r, 10000));

    // Verify
    console.log('\nStep 4: Verifying IP change...');
    let newIp = 'pending';

    for (let i = 1; i <= 5; i++) {
      console.log(`   Attempt ${i}/5...`);

      try {
        const statusUrl = targetProxy.statusByToken ||
          `https://mreset.xyz/get-modem-status/${targetProxy.restartToken}`;

        const statusResp = await axios.get(statusUrl, { timeout: 10000 });
        const data = statusResp.data.data || statusResp.data;
        const currentIp = data.ext_ip || data.external_ip || data.current_ip || data.ip;

        if (currentIp && currentIp !== oldIp && currentIp !== 'unknown') {
          newIp = currentIp;
          console.log(`   ✅ New IP: ${newIp}\n`);
          break;
        }
      } catch (e) {
        console.log(`   ⚠️  Check failed: ${e.message}`);
      }

      if (i < 5) await new Promise(r => setTimeout(r, 4000));
    }

    console.log('═'.repeat(60));
    console.log('RESULT:');
    console.log(`  Proxy: ${targetProxy.name}`);
    console.log(`  Old IP: ${oldIp}`);
    console.log(`  New IP: ${newIp}`);
    console.log(`  Status: ${newIp !== 'pending' && newIp !== oldIp ? '✅ SUCCESS' : '⚠️ TIMEOUT'}`);
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('❌ Rotation failed:', error.message);
    process.exit(1);
  }
}

main();
