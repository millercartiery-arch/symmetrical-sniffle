
const http = require('http');

// Check messages for specific phone
const phone = '18083216357';
const url = `http://localhost:3000/api/user/chat/messages?peerPhone=${phone}`;

console.log(`Fetching messages for ${phone}...`);

http.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(data);
  });
}).on('error', (err) => {
  console.error("Error: " + err.message);
});
