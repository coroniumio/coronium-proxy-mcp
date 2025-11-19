import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = process.env.CORONIUM_BASE_URL || 'https://api.coronium.io/v1';

async function main() {
  // Auth
  const authResp = await axios.post(`${API_BASE}/get-token`, {
    login: process.env.CORONIUM_LOGIN,
    password: process.env.CORONIUM_PASSWORD
  });
  const token = authResp.data.token;

  // Get proxies
  const proxiesResp = await axios.get(`${API_BASE}/account/proxies`, {
    params: { auth_token: token }
  });

  const proxies = proxiesResp.data.data || [];

  console.log('Full proxy data:\n');
  console.log(JSON.stringify(proxies, null, 2));
}

main();
