import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = 'https://api.coronium.io/v1';

async function main() {
  const authResp = await axios.post(`${API_BASE}/get-token`, {
    login: process.env.CORONIUM_LOGIN,
    password: process.env.CORONIUM_PASSWORD
  });

  const proxiesResp = await axios.get(`${API_BASE}/account/proxies`, {
    params: { auth_token: authResp.data.token }
  });

  const proxies = proxiesResp.data.data || [];
  
  console.log('Proxy 1 structure (relevant fields):');
  const p1 = proxies[0];
  console.log('Name:', p1.name);
  console.log('ID:', p1._id);
  console.log('restartToken:', p1.restartToken);
  console.log('restartByToken:', p1.restartByToken);
  console.log('statusByToken:', p1.statusByToken);
  console.log('');
  
  console.log('Full proxy object keys:');
  console.log(Object.keys(p1));
}

main().catch(e => console.error('Error:', e.message));
