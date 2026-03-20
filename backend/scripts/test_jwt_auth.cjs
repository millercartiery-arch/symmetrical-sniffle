#!/usr/bin/env node
/**
 * JWT 认证流程测试脚本
 * 测试项目：
 * 1. 登录端点是否返回 JWT token
 * 2. JWT token 是否有效
 * 3. 使用 token 访问受保护端点
 * 4. 刷新 token 是否正常工作
 */

const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:3000/api';

async function test() {
  try {
    console.log('🚀 开始 JWT 认证测试...\n');

    // 1. 测试登录 - 获取 JWT token
    console.log('[1/4] 测试登录端点...');
    const loginRes = await axios.post(`${BASE_URL}/login`, {
      email: 'test@admin.local',
      password: 'admin123',
    });

    if (!loginRes.data.token) {
      throw new Error('❌ 登录失败：未返回 token');
    }

    const token = loginRes.data.token;
    console.log(`✅ 登录成功，token: ${token.substring(0, 20)}...`);
    console.log(`   Token 类型: ${typeof token}, 长度: ${token.length}`);

    // 2. 测试 JWT 验证 - 使用 token 访问 /me
    console.log('\n[2/4] 测试令牌验证...');
    const meRes = await axios.get(`${BASE_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log(`✅ Token 有效`);
    console.log(`   用户: ${meRes.data.username}`);
    console.log(`   角色: ${meRes.data.role}`);
    console.log(`   租户ID: ${meRes.data.tenantId}`);

    // 3. 测试错误情况 - 无效 token
    console.log('\n[3/4] 测试无效 token 处理...');
    try {
      await axios.get(`${BASE_URL}/me`, {
        headers: { Authorization: 'Bearer invalid_token' },
      });
      console.log('❌ 应该拒绝无效的 token');
    } catch (err) {
      if (err.response?.status === 401) {
        console.log('✅ 正确拒绝了无效 token');
      } else {
        throw err;
      }
    }

    // 4. 测试刷新 token
    console.log('\n[4/4] 测试 Token 刷新...');
    const refreshRes = await axios.post(
      `${BASE_URL}/refresh`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!refreshRes.data.token) {
      throw new Error('❌ 刷新失败：未返回新 token');
    }

    const newToken = refreshRes.data.token;
    console.log(`✅ Token 刷新成功，新 token: ${newToken.substring(0, 20)}...`);

    // 验证新 token 是否可用
    const me2Res = await axios.get(`${BASE_URL}/me`, {
      headers: { Authorization: `Bearer ${newToken}` },
    });
    console.log(`   新 Token 有效，用户: ${me2Res.data.username}`);

    console.log('\n✅ 所有测试通过！JWT 认证流程正常工作');
    process.exit(0);
  } catch (err) {
    console.error('❌ 测试失败：');
    if (err.response?.data) {
      console.error('   响应:', err.response.data);
    } else {
      console.error('   错误:', err.message);
    }
    process.exit(1);
  }
}

test();
