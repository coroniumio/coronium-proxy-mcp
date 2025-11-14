import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

// Token storage configuration
const tokenDir = path.join(os.homedir(), '.coronium');
const tokenFilePath = path.join(tokenDir, 'token.enc');
const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

// Decrypt function to get token
function decrypt(encryptedText) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(encryptionKey, 'salt', 32);
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedData = Buffer.from(parts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedData, null, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Get stored token
function getStoredToken() {
  try {
    if (fs.existsSync(tokenFilePath)) {
      const encryptedToken = fs.readFileSync(tokenFilePath, 'utf8');
      return decrypt(encryptedToken);
    }
  } catch (error) {
    console.error('Error reading token:', error);
  }
  return null;
}

async function testProxiesAPI() {
  const token = getStoredToken();

  if (!token) {
    console.error('No stored token found. Please authenticate first.');
    return;
  }

  console.log('Token found, making API call...\n');

  try {
    const response = await axios.get('https://api.coronium.io/v1/account/proxies', {
      params: {
        auth_token: token
      }
    });

    console.log('=== FULL API RESPONSE ===');
    console.log(JSON.stringify(response.data, null, 2));

    // Save to file for documentation
    fs.writeFileSync('api-response-proxies.json', JSON.stringify(response.data, null, 2));
    console.log('\nResponse saved to api-response-proxies.json');

    // Extract rotation tokens if present
    if (response.data?.data && Array.isArray(response.data.data)) {
      console.log('\n=== ROTATION TOKENS ===');
      response.data.data.forEach((proxy, index) => {
        console.log(`\nProxy ${index + 1}: ${proxy.name || proxy._id}`);
        if (proxy.rotation_token || proxy.api_token || proxy.rotate_token) {
          console.log(`  Rotation Token: ${proxy.rotation_token || proxy.api_token || proxy.rotate_token}`);
        }
        if (proxy.rotation_link || proxy.rotate_link || proxy.api_link) {
          console.log(`  Rotation Link: ${proxy.rotation_link || proxy.rotate_link || proxy.api_link}`);
        }
        // Log all fields to find the rotation-related ones
        const rotationFields = Object.keys(proxy).filter(key =>
          key.toLowerCase().includes('rotat') ||
          key.toLowerCase().includes('api') ||
          key.toLowerCase().includes('token')
        );
        if (rotationFields.length > 0) {
          console.log(`  Related fields: ${rotationFields.join(', ')}`);
        }
      });
    }

  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
  }
}

// Test other endpoints
async function testAllEndpoints() {
  const token = getStoredToken();

  if (!token) {
    console.error('No stored token found. Please authenticate first.');
    return;
  }

  const endpoints = [
    { name: 'Proxies', path: '/account/proxies' },
    { name: 'Crypto Balance', path: '/account/crypto-balance' },
    { name: 'Credit Cards', path: '/account/card-list' }
  ];

  for (const endpoint of endpoints) {
    console.log(`\n=== Testing ${endpoint.name} ===`);
    try {
      const response = await axios.get(`https://api.coronium.io/v1${endpoint.path}`, {
        params: {
          auth_token: token
        }
      });

      const filename = `api-response-${endpoint.name.toLowerCase().replace(' ', '-')}.json`;
      fs.writeFileSync(filename, JSON.stringify(response.data, null, 2));
      console.log(`Response saved to ${filename}`);
      console.log('Sample response:', JSON.stringify(response.data, null, 2).substring(0, 500) + '...');
    } catch (error) {
      console.error(`Error for ${endpoint.name}:`, error.response?.data || error.message);
    }
  }
}

// Run tests
testProxiesAPI().then(() => {
  console.log('\n=== Testing all endpoints ===');
  return testAllEndpoints();
});