/**
 * PM2 进程配置，用于服务器部署。
 * 在服务器上：cd /var/www/massmail/backend && pm2 start ecosystem.config.cjs
 * 会注入 FRONTEND_DIR，避免 existsSync 因权限/cwd 找不到前端目录。
 */
module.exports = {
  apps: [
    {
      name: "massmail-api",
      cwd: "/var/www/massmail/backend",
      script: "dist/index.js",
      node_args: "--inspect=0.0.0.0:9229",
      env: {
        NODE_ENV: "production",
        FRONTEND_DIR: "/var/www/massmail/frontend/dist",
      },
    },
  ],
};
