import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_BASE = 'https://api.coronium.io/v1';

async function main() {
  console.log('🔍 Account Verification Check\n');
  console.log('═'.repeat(50) + '\n');

  const authResp = await axios.post(`${API_BASE}/get-token`, {
    login: process.env.CORONIUM_LOGIN,
    password: process.env.CORONIUM_PASSWORD
  });
  const token = authResp.data.token;
  console.log('✅ Authentication: OK\n');

  // Check crypto balance
  try {
    const cryptoResp = await axios.get(`${API_BASE}/account/crypto-balance`, {
      params: { auth_token: token }
    });
    console.log(`Crypto accounts: ${cryptoResp.data.length}`);
    cryptoResp.data.forEach(c => {
      console.log(`  - ${c.coin}: ${c.balance}`);
    });
  } catch (e) {
    console.log('Crypto check failed:', e.message);
  }

  console.log('');

  // Check cards
  try {
    const cardsResp = await axios.get(`${API_BASE}/account/card-list`, {
      params: { auth_token: token }
    });
    console.log(`Cards: ${cardsResp.data.data?.length || 0}`);
  } catch (e) {
    console.log('Cards check failed:', e.message);
  }

  console.log('');

  // Check proxies
  const proxiesResp = await axios.get(`${API_BASE}/account/proxies`, {
    params: { auth_token: token }
  });

  const count = proxiesResp.data.data?.length || 0;
  console.log(`Proxies: ${count}`);

  if (count === 0) {
    console.log('\n⚠️  NO PROXIES FOUND IN ACCOUNT');
    console.log('   This could mean:');
    console.log('   1. Proxies were removed/expired');
    console.log('   2. Subscription ended');
    console.log('   3. Account issue');
    console.log('\n   Check: https://dashboard.coronium.io');
  } else {
    proxiesResp.data.data.forEach((p, i) => {
      console.log(`\n${i+1}. ${p.name}`);
      console.log(`   IP: ${p.ext_ip}`);
      console.log(`   Status: ${p.isOnline ? 'Online' : 'Offline'}`);
    });
  }

  console.log('\n' + '═'.repeat(50));
}

main().catch(e => console.error('Error:', e.message));
