
const http = require('http');

http.get('http://localhost:3000/api/dashboard/stats', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log("Stats:", data);
  });
}).on('error', (err) => {
  console.error("Error: " + err.message);
});

http.get('http://localhost:3000/api/dashboard/activities', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log("Activities:", data);
  });
}).on('error', (err) => {
  console.error("Error: " + err.message);
});
