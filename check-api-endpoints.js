import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = 'https://api.coronium.io/v1';

async function main() {
  console.log('🔍 Checking Coronium API endpoints...\n');

  // Authenticate
  const authResp = await axios.post(`${API_BASE}/get-token`, {
    login: process.env.CORONIUM_LOGIN,
    password: process.env.CORONIUM_PASSWORD
  });
  const token = authResp.data.token;

  // Try to find rotation endpoint
  const endpoints = [
    '/account/proxies',
    '/account/proxy/rotate',
    '/account/modem/rotate',
    '/account/modem/restart',
    '/proxy/rotate',
    '/modem/rotate'
  ];

  console.log('Testing potential rotation endpoints:\n');

  for (const endpoint of endpoints) {
    try {
      const url = `${API_BASE}${endpoint}`;
      console.log(`   Testing: ${url}`);

      const resp = await axios.get(url, {
        params: { auth_token: token },
        timeout: 5000,
        validateStatus: () => true
      });

      console.log(`      Status: ${resp.status}`);

      if (resp.status === 200) {
        console.log(`      ✅ Endpoint exists!`);
        const preview = JSON.stringify(resp.data).substring(0, 100);
        console.log(`      Response: ${preview}...\n`);
      } else if (resp.status === 404) {
        console.log(`      ❌ Not found\n`);
      } else {
        console.log(`      ⚠️  Response: ${JSON.stringify(resp.data)}\n`);
      }
    } catch (e) {
      console.log(`      ❌ Error: ${e.message}\n`);
    }
  }

  // Check proxy object for any rotate-related fields
  console.log('\n📋 Checking proxy object for rotation-related fields:\n');
  const proxiesResp = await axios.get(`${API_BASE}/account/proxies`, {
    params: { auth_token: token }
  });

  const proxy = proxiesResp.data.data[0];
  const rotationFields = Object.keys(proxy).filter(k =>
    k.toLowerCase().includes('rot') ||
    k.toLowerCase().includes('restart') ||
    k.toLowerCase().includes('reset')
  );

  console.log('   Rotation-related fields:');
  rotationFields.forEach(field => {
    console.log(`      ${field}: ${proxy[field]}`);
  });
}

main().catch(e => console.error('Error:', e.message));
