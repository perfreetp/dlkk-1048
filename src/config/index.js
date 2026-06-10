require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT) || 3000,
    env: process.env.NODE_ENV || 'development'
  },
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/property_dunning',
    options: JSON.parse(process.env.MONGODB_OPTIONS || '{"useNewUrlParser":true,"useUnifiedTopology":true}')
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/app.log'
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000
  },
  dunning: {
    cooldownHours: parseInt(process.env.DUNNING_COOLDOWN_HOURS) || 24,
    overdueLevel1Days: parseInt(process.env.OVERDUE_LEVEL1_DAYS) || 30,
    overdueLevel2Days: parseInt(process.env.OVERDUE_LEVEL2_DAYS) || 90,
    overdueLevel3Days: parseInt(process.env.OVERDUE_LEVEL3_DAYS) || 180
  },
  sms: {
    url: process.env.SMS_PLATFORM_URL,
    apiKey: process.env.SMS_PLATFORM_API_KEY
  },
  charging: {
    url: process.env.CHARGING_SYSTEM_URL,
    apiKey: process.env.CHARGING_SYSTEM_API_KEY
  },
  export: {
    path: process.env.EXPORT_PATH || 'exports'
  }
};

module.exports = config;
