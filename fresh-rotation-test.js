#!/usr/bin/env node

/**
 * Coronium Fresh Rotation Test
 * Fetches proxies immediately before rotation to ensure fresh tokens
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = 'https://api.coronium.io/v1';

console.log('🔄 Coronium Fresh Rotation Test');
console.log('   Strategy: Fetch fresh proxy list immediately before rotation\n');
console.log('═'.repeat(70) + '\n');

async function authenticate() {
  console.log('📍 Step 1: Authenticating...');
  const response = await axios.post(`${API_BASE}/get-token`, {
    login: process.env.CORONIUM_LOGIN,
    password: process.env.CORONIUM_PASSWORD
  });
  console.log('✅ Authenticated\n');
  return response.data.token;
}

async function getFreshProxies(token) {
  console.log('📍 Step 2: Fetching FRESH proxy list with current rotation tokens...');
  const response = await axios.get(`${API_BASE}/account/proxies`, {
    params: { auth_token: token }
  });
  const proxies = response.data.data || [];
  console.log(`✅ Retrieved ${proxies.length} proxies with fresh data\n`);
  return proxies;
}

async function selectProxyInteractive(proxies) {
  console.log('📋 Available Proxies:\n');
  proxies.forEach((p, i) => {
    const country = p.name?.split('_')[1] || 'Unknown';
    console.log(`   ${i + 1}. ${p.name}`);
    console.log(`      ID: ${p._id}`);
    console.log(`      Country: ${country.toUpperCase()}`);
    console.log(`      Current IP: ${p.ext_ip}`);
    console.log(`      Status: ${p.isOnline ? '🟢 Online' : '🔴 Offline'}`);
    console.log(`      Rotation Available: ${p.restartByToken ? '✅ Yes' : '❌ No'}`);
    console.log('');
  });

  // Select first proxy with valid rotation token
  const selected = proxies.find(p => p.restartByToken && p.isOnline);

  if (!selected) {
    throw new Error('No online proxy with rotation capability found');
  }

  console.log(`🎯 Auto-selected: ${selected.name} (${selected.ext_ip})\n`);
  return selected;
}

async function rotateWithFreshToken(proxy, token) {
  const oldIp = proxy.ext_ip;

  console.log('📍 Step 3: Initiating rotation with FRESH token...');
  console.log(`   Proxy: ${proxy.name}`);
  console.log(`   Current IP: ${oldIp}`);
  console.log(`   Rotation URL: ${proxy.restartByToken}`);

  // Get fresh timestamp info
  const tokenCreatedAt = new Date().toISOString();
  console.log(`   Token fetched: ${tokenCreatedAt}\n`);

  try {
    console.log('🔄 Sending rotation request...');
    const rotateResponse = await axios.get(proxy.restartByToken, {
      timeout: 30000,
      validateStatus: () => true
    });

    console.log(`   Response Status: ${rotateResponse.status}`);
    console.log(`   Response Body: ${JSON.stringify(rotateResponse.data)}\n`);

    // Check for errors
    if (rotateResponse.status === 404) {
      console.log('❌ 404 Error - Endpoint not found or modem offline');
      return { success: false, error: '404 Not Found' };
    }

    if (rotateResponse.data.error) {
      console.log(`❌ Error from rotation service: ${rotateResponse.data.error}`);

      if (rotateResponse.data.error.includes('expired')) {
        console.log('\n⚠️  Token is STILL expired even after fresh fetch!');
        console.log('   This indicates tokens may be expired on Coronium\'s side.');
        console.log('   Action needed: Contact Coronium support or check dashboard.\n');
      }

      return { success: false, error: rotateResponse.data.error };
    }

    console.log('✅ Rotation request accepted!\n');

    // Wait for modem restart
    console.log('📍 Step 4: Waiting for modem restart...');
    console.log('   Initial wait: 12 seconds...');
    await new Promise(r => setTimeout(r, 12000));

    // Verify IP change with multiple methods
    console.log('\n📍 Step 5: Verifying IP change...\n');

    let newIp = null;
    let verificationMethod = null;

    // Method 1: Status endpoint (if available)
    if (proxy.statusByToken) {
      console.log('   Method 1: Checking status endpoint...');

      for (let attempt = 1; attempt <= 5; attempt++) {
        console.log(`      Attempt ${attempt}/5...`);

        try {
          const statusResp = await axios.get(proxy.statusByToken, {
            timeout: 10000,
            validateStatus: () => true
          });

          const data = statusResp.data.data || statusResp.data;
          const currentIp = data.ext_ip || data.external_ip || data.current_ip || data.ip;

          if (currentIp && currentIp !== 'unknown') {
            console.log(`         IP from status: ${currentIp}`);

            if (currentIp !== oldIp) {
              newIp = currentIp;
              verificationMethod = 'Status Endpoint';
              console.log(`         ✅ IP changed detected!\n`);
              break;
            } else {
              console.log(`         ⏳ Still showing old IP, waiting...`);
            }
          }
        } catch (e) {
          console.log(`         ⚠️  Status check failed: ${e.message}`);
        }

        if (attempt < 5 && !newIp) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    }

    // Method 2: Coronium API fallback
    if (!newIp) {
      console.log('\n   Method 2: Checking via Coronium API...');
      await new Promise(r => setTimeout(r, 5000));

      try {
        const freshProxies = await axios.get(`${API_BASE}/account/proxies`, {
          params: { auth_token: token }
        });

        const updatedProxy = freshProxies.data.data.find(p => p._id === proxy._id);

        if (updatedProxy && updatedProxy.ext_ip !== oldIp) {
          newIp = updatedProxy.ext_ip;
          verificationMethod = 'Coronium API';
          console.log(`      ✅ New IP confirmed: ${newIp}\n`);
        } else {
          console.log(`      ⏳ API still shows old IP: ${updatedProxy?.ext_ip || 'unknown'}\n`);
        }
      } catch (e) {
        console.log(`      ⚠️  API check failed: ${e.message}\n`);
      }
    }

    // Final result
    console.log('═'.repeat(70));
    if (newIp) {
      console.log('✅ ROTATION SUCCESSFUL!');
      console.log('═'.repeat(70));
      console.log(`   Proxy: ${proxy.name}`);
      console.log(`   Old IP: ${oldIp}`);
      console.log(`   New IP: ${newIp}`);
      console.log(`   Verified by: ${verificationMethod}`);
      console.log(`   Duration: ~${Math.floor((Date.now() - Date.parse(tokenCreatedAt)) / 1000)}s`);
      console.log('═'.repeat(70));
      return { success: true, oldIp, newIp, method: verificationMethod };
    } else {
      console.log('⚠️  ROTATION STATUS UNKNOWN');
      console.log('═'.repeat(70));
      console.log(`   Proxy: ${proxy.name}`);
      console.log(`   Old IP: ${oldIp}`);
      console.log(`   New IP: Could not verify (may still be rotating)`);
      console.log(`   Suggestion: Check manually in 1-2 minutes`);
      console.log('═'.repeat(70));
      return { success: false, oldIp, error: 'Verification timeout' };
    }

  } catch (error) {
    console.log('❌ Rotation failed with exception:', error.message);
    return { success: false, error: error.message };
  }
}

async function main() {
  try {
    // Step 1: Authenticate
    const token = await authenticate();

    // Step 2: Get FRESH proxy list
    const proxies = await getFreshProxies(token);

    if (proxies.length === 0) {
      console.log('❌ No proxies found in account\n');
      return;
    }

    // Step 3: Select proxy
    const targetProxy = await selectProxyInteractive(proxies);

    // Confirmation prompt
    console.log('⚠️  About to rotate IP for this proxy.');
    console.log('   Press Ctrl+C to cancel, or wait 3 seconds to continue...\n');
    await new Promise(r => setTimeout(r, 3000));

    // Step 4: Rotate with fresh token
    const result = await rotateWithFreshToken(targetProxy, token);

    console.log('\n📊 Test Result:', result.success ? '✅ SUCCESS' : '❌ FAILED');

    if (!result.success && result.error) {
      console.log('   Error:', result.error);

      if (result.error.includes('expired')) {
        console.log('\n💡 Recommendation:');
        console.log('   Rotation tokens are expired on Coronium\'s side.');
        console.log('   Please contact: hello@coronium.io');
        console.log('   Or check: https://dashboard.coronium.io');
      }
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run test
main();
