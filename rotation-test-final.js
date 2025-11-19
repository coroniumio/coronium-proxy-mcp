import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = 'https://api.coronium.io/v1';

async function main() {
  console.log('🔄 Coronium Modem Rotation Test\n');
  console.log('═'.repeat(70) + '\n');

  // Step 1: Authenticate
  console.log('Step 1: Authenticating...');
  const authResp = await axios.post(`${API_BASE}/get-token`, {
    login: process.env.CORONIUM_LOGIN,
    password: process.env.CORONIUM_PASSWORD
  });
  const token = authResp.data.token;
  console.log('✅ Authenticated\n');

  // Step 2: Get fresh proxy list
  console.log('Step 2: Fetching current proxies with fresh rotation tokens...');
  const proxiesResp = await axios.get(`${API_BASE}/account/proxies`, {
    params: { auth_token: token }
  });
  const proxies = proxiesResp.data.data || [];
  console.log(`✅ Found ${proxies.length} proxies\n`);

  proxies.forEach((p, i) => {
    console.log(`${i + 1}. ${p.name}`);
    console.log(`   ID: ${p._id}`);
    console.log(`   Current IP: ${p.ext_ip}`);
    console.log(`   Has rotation token: ${p.restartByToken ? '✅' : '❌'}`);
    console.log('');
  });

  // Step 3: Select proxy - Try Ukraine proxy
  const targetProxy = proxies.find(p => p.name.includes('_ua')) || proxies[0];
  console.log(`🎯 Selected for rotation: ${targetProxy.name}`);
  console.log(`   Current IP: ${targetProxy.ext_ip}\n`);

  // Step 4: Initiate rotation
  console.log('Step 3: Initiating rotation...');
  console.log(`   URL: ${targetProxy.restartByToken}\n`);

  const oldIp = targetProxy.ext_ip;

  try {
    const rotateResp = await axios.get(targetProxy.restartByToken, {
      timeout: 30000,
      validateStatus: () => true // Accept all status codes
    });

    console.log('   Response status:', rotateResp.status);
    console.log('   Response data:', JSON.stringify(rotateResp.data));

    if (rotateResp.status === 404) {
      console.log('\n❌ 404 Error - Modem might be offline or token invalid');
      return;
    }

    if (rotateResp.data.error) {
      console.log('\n⚠️  API Error:', rotateResp.data.error);
      console.log('   This typically means rotation tokens need to be refreshed by Coronium');
      return;
    }

    console.log('\n✅ Rotation initiated!');

  } catch (error) {
    console.log('\n❌ Rotation request failed:', error.message);
    return;
  }

  // Step 5: Wait for modem restart
  console.log('\nStep 4: Waiting 15 seconds for modem to restart...');
  await new Promise(r => setTimeout(r, 15000));

  // Step 6: Verify IP change
  console.log('\nStep 5: Verifying IP change...');

  for (let attempt = 1; attempt <= 5; attempt++) {
    console.log(`   Attempt ${attempt}/5...`);

    try {
      if (targetProxy.statusByToken) {
        const statusResp = await axios.get(targetProxy.statusByToken, {
          timeout: 10000,
          validateStatus: () => true
        });

        const data = statusResp.data.data || statusResp.data;
        const currentIp = data.ext_ip || data.external_ip || data.current_ip || data.ip;

        console.log(`      Status API IP: ${currentIp || 'unknown'}`);

        if (currentIp && currentIp !== oldIp && currentIp !== 'unknown') {
          console.log('\n' + '═'.repeat(70));
          console.log('✅ SUCCESS! IP ROTATION COMPLETE');
          console.log('═'.repeat(70));
          console.log(`   Proxy: ${targetProxy.name}`);
          console.log(`   Old IP: ${oldIp}`);
          console.log(`   New IP: ${currentIp}`);
          console.log('═'.repeat(70));
          return;
        }
      }
    } catch (e) {
      console.log(`      ⚠️  Check failed: ${e.message}`);
    }

    if (attempt < 5) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Fallback: Check via Coronium API
  console.log('\n   Trying fallback: Coronium API check...');
  try {
    const finalProxies = await axios.get(`${API_BASE}/account/proxies`, {
      params: { auth_token: token }
    });
    const finalProxy = finalProxies.data.data.find(p => p._id === targetProxy._id);

    if (finalProxy && finalProxy.ext_ip !== oldIp) {
      console.log('\n' + '═'.repeat(70));
      console.log('✅ SUCCESS! IP VERIFIED VIA API');
      console.log('═'.repeat(70));
      console.log(`   Proxy: ${targetProxy.name}`);
      console.log(`   Old IP: ${oldIp}`);
      console.log(`   New IP: ${finalProxy.ext_ip}`);
      console.log('═'.repeat(70));
    } else {
      console.log('\n⚠️  Rotation may still be in progress - check again in a minute');
    }
  } catch (e) {
    console.log('   API check failed:', e.message);
  }
}

main().catch(e => console.error('\n❌ Fatal error:', e.message));
