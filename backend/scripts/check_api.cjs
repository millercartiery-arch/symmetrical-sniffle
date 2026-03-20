
const http = require('http');

http.get('http://localhost:3000/api/user/chat/conversations?limit=10', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(data);
  });
}).on('error', (err) => {
  console.error("Error: " + err.message);
});
