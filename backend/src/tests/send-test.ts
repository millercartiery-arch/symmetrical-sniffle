import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

async function testSend() {
  console.log('--- Testing Send Campaign (TC-01) ---');
  try {
    const payload = {
      name: 'Test VIP Campaign',
      content: 'Hello, this is a test message!',
      targets: '1234567890\n0987654321',
      mediaUrl: 'http://example.com/image.png'
    };

    const createResp = await axios.post(`${BASE_URL}/user/campaigns`, payload);
    console.log('Create Response:', createResp.data);

    if (createResp.data.code === 0) {
      console.log('✓ Campaign created successfully');
    } else {
      console.log('✗ Campaign creation failed');
    }

    console.log('\n--- Fetching Campaigns ---');
    const listResp = await axios.get(`${BASE_URL}/user/campaigns`);
    console.log('Campaign List (Top 1):', listResp.data.data[0]);

    if (listResp.data.code === 0 && listResp.data.data.length > 0) {
      console.log('✓ Campaign list fetched successfully');
    } else {
      console.log('✗ Campaign list fetch failed');
    }

    console.log('\n--- Fetching Tasks for Campaign ---');
    const tasksResp = await axios.get(`${BASE_URL}/user/tasks`, {
      params: { campaignId: createResp.data.data.campaignId }
    });
    console.log(`Tasks found: ${tasksResp.data.data.length}`);

    if (tasksResp.data.code === 0 && tasksResp.data.data.length === 2) {
      console.log('✓ All tasks created correctly');
    } else {
      console.log('✗ Task creation mismatch');
    }

  } catch (err: any) {
    console.error('Error during test:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
  }
}

testSend();
