
const http = require('http');

const url = 'http://localhost:3000/api/user/chat/conversations?limit=10';

console.log(`Checking ${url}...`);

http.get(url, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log("Response:", data.substring(0, 500)); // Print first 500 chars
  });
}).on('error', (err) => {
  console.error("Error: " + err.message);
});
