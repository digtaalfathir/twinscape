module.exports = {
  apps: [
    {
      name: "hardware-monitoring",
      script: "./src/app.js",
      cwd: __dirname,                 // = folder legacy/ → src/app.js, logs/, config.json, data/ ada di sini
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production"
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true
    }
  ]
};
