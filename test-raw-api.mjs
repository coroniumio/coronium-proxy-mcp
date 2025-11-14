import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// First authenticate to get token
async function authenticate() {
  const email = process.env.CORONIUM_LOGIN || process.env.CORONIUM_EMAIL;
  const password = process.env.CORONIUM_PASSWORD;

  if (!email || !password) {
    console.error('Missing CORONIUM_LOGIN/EMAIL and CORONIUM_PASSWORD env vars');
    return null;
  }

  try {
    const response = await axios.post('https://api.coronium.io/v1/get-token', {
      login: email,
      password: password
    });

    if (response.data?.token) {
      console.log('Authentication successful!');
      return response.data.token;
    }
  } catch (error) {
    console.error('Authentication failed:', error.response?.data || error.message);
  }
  return null;
}

async function testProxiesAPI(token) {
  console.log('\n=== PROXIES API CALL ===');
  console.log('Making request to: https://api.coronium.io/v1/account/proxies');
  console.log('Using params: { auth_token: token }');

  try {
    const response = await axios.get('https://api.coronium.io/v1/account/proxies', {
      params: {
        auth_token: token
      }
    });

    console.log('\n=== FULL RAW API RESPONSE ===');
    console.log(JSON.stringify(response.data, null, 2));

    // Save to file for documentation
    fs.writeFileSync('api-response-proxies.json', JSON.stringify(response.data, null, 2));
    console.log('\nResponse saved to api-response-proxies.json');

    // Analyze structure
    if (response.data?.data && Array.isArray(response.data.data)) {
      console.log('\n=== RESPONSE STRUCTURE ANALYSIS ===');
      console.log(`Total proxies: ${response.data.data.length}`);

      if (response.data.data.length > 0) {
        const firstProxy = response.data.data[0];
        console.log('\nAvailable fields in proxy object:');
        Object.keys(firstProxy).forEach(key => {
          const value = firstProxy[key];
          const type = typeof value;
          console.log(`  - ${key}: ${type}${value === null ? ' (null)' : value === '' ? ' (empty)' : ''}`);
        });

        // Look for rotation-related fields
        console.log('\n=== ROTATION-RELATED FIELDS ===');
        response.data.data.forEach((proxy, index) => {
          console.log(`\nProxy ${index + 1}: ${proxy.name || proxy._id}`);

          // Check all possible rotation fields
          const rotationFields = [
            'rotation_token', 'api_token', 'rotate_token', 'token',
            'rotation_link', 'rotate_link', 'api_link', 'link',
            'rotation_url', 'rotate_url', 'api_url',
            'rotated_at', 'last_rotation', 'rotation_interval'
          ];

          rotationFields.forEach(field => {
            if (proxy[field] !== undefined && proxy[field] !== null && proxy[field] !== '') {
              console.log(`  ${field}: ${proxy[field]}`);
            }
          });

          // Check for any field containing 'api', 'token', 'rotat'
          Object.keys(proxy).forEach(key => {
            if (key.toLowerCase().includes('api') ||
                key.toLowerCase().includes('token') ||
                key.toLowerCase().includes('rotat')) {
              if (!rotationFields.includes(key)) {
                console.log(`  ${key}: ${proxy[key]}`);
              }
            }
          });
        });
      }
    }

    return response.data;
  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
    return null;
  }
}

async function testAllEndpoints(token) {
  const endpoints = [
    { name: 'Crypto Balance', path: '/account/crypto-balance' },
    { name: 'Credit Cards', path: '/account/card-list' }
  ];

  for (const endpoint of endpoints) {
    console.log(`\n=== Testing ${endpoint.name} ===`);
    console.log(`Request: GET https://api.coronium.io/v1${endpoint.path}`);
    console.log('Params: { auth_token: token }');

    try {
      const response = await axios.get(`https://api.coronium.io/v1${endpoint.path}`, {
        params: {
          auth_token: token
        }
      });

      const filename = `api-response-${endpoint.name.toLowerCase().replace(' ', '-')}.json`;
      fs.writeFileSync(filename, JSON.stringify(response.data, null, 2));
      console.log(`\nFull response saved to ${filename}`);
      console.log('\nResponse structure:', JSON.stringify(response.data, null, 2).substring(0, 500) + '...');
    } catch (error) {
      console.error(`Error for ${endpoint.name}:`, error.response?.data || error.message);
    }
  }
}

// Main execution
async function main() {
  const token = await authenticate();

  if (!token) {
    console.error('Failed to authenticate. Cannot proceed with API tests.');
    return;
  }

  console.log(`\nUsing token: ${token.substring(0, 20)}...`);

  await testProxiesAPI(token);
  await testAllEndpoints(token);

  console.log('\n=== API TESTING COMPLETE ===');
  console.log('Check the following files for full responses:');
  console.log('  - api-response-proxies.json');
  console.log('  - api-response-crypto-balance.json');
  console.log('  - api-response-credit-cards.json');
}

main().catch(console.error);